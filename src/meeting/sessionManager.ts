import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AttachmentBuilder,
  EmbedBuilder,
  type Client,
  type GuildTextBasedChannel,
  type VoiceBasedChannel,
} from "discord.js";
import {
  EndBehaviorType,
  getVoiceConnection,
  VoiceConnectionStatus,
  type VoiceConnection,
} from "@discordjs/voice";
import prism from "prism-media";
import { resolveMeetingRecordChannel } from "./channels";
import { compressMeetingPcm } from "./compress";
import { countHumansInVoice } from "./permissions";
import { PcmMixer } from "./recorder";
import { joinVoiceChannelReady } from "../voice/join";

const EMPTY_STOP_MS = 3 * 60 * 1000;

export type RecordingStatus = "recording" | "paused" | "stopping";

export interface MeetingRecordingSession {
  voiceChannelId: string;
  guildId: string;
  categoryId: string | null;
  recordChannelId: string;
  starterId: string;
  startedAt: Date;
  status: RecordingStatus;
  connection: VoiceConnection;
  mixer: PcmMixer;
  pcmPath: string;
  workDir: string;
  emptyTimer: NodeJS.Timeout | null;
  activeSpeakers: Set<string>;
}

const sessions = new Map<string, MeetingRecordingSession>();

export function getSession(
  voiceChannelId: string,
): MeetingRecordingSession | undefined {
  return sessions.get(voiceChannelId);
}

export function listGuildSessions(guildId: string): MeetingRecordingSession[] {
  return [...sessions.values()].filter((s) => s.guildId === guildId);
}

export function hasActiveMeetingInGuild(guildId: string): boolean {
  return [...sessions.values()].some((s) => s.guildId === guildId);
}

export function getSessionForMemberVoice(
  voiceChannelId: string | null | undefined,
): MeetingRecordingSession | undefined {
  if (!voiceChannelId) return undefined;
  return sessions.get(voiceChannelId);
}

function createWorkDir(guildId: string, channelId: string): string {
  const dir = path.join(
    os.tmpdir(),
    "ludeen-meetings",
    `${guildId}-${channelId}-${Date.now()}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function subscribeSpeaker(
  session: MeetingRecordingSession,
  userId: string,
  botUserId: string,
): void {
  if (userId === botUserId) return;
  if (session.activeSpeakers.has(userId)) return;
  if (session.status === "stopping") return;

  session.activeSpeakers.add(userId);

  const opusStream = session.connection.receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 300,
    },
  });

  const decoder = new prism.opus.Decoder({
    rate: 48_000,
    channels: 2,
    frameSize: 960,
  });

  opusStream.pipe(decoder);

  decoder.on("data", (chunk: Buffer) => {
    if (session.status === "recording") {
      session.mixer.push(userId, chunk);
    }
  });

  const cleanup = () => {
    session.activeSpeakers.delete(userId);
    opusStream.destroy();
    decoder.destroy();
  };

  opusStream.on("end", cleanup);
  opusStream.on("close", cleanup);
  opusStream.on("error", cleanup);
  decoder.on("error", cleanup);
}

export async function startRecording(options: {
  client: Client;
  voiceChannel: VoiceBasedChannel;
  starterId: string;
}): Promise<MeetingRecordingSession> {
  const { client, voiceChannel, starterId } = options;

  if (sessions.has(voiceChannel.id)) {
    throw new Error("This meeting voice channel is already being recorded.");
  }

  const existingInGuild = [...sessions.values()].find(
    (s) => s.guildId === voiceChannel.guild.id,
  );
  if (existingInGuild) {
    throw new Error(
      `Already recording in <#${existingInGuild.voiceChannelId}>. Discord only allows one voice channel per server — stop that recording first.`,
    );
  }

  const { hasActiveLofiInGuild, getLofiSession } = await import(
    "../lofi/sessionManager"
  );
  if (hasActiveLofiInGuild(voiceChannel.guild.id)) {
    const lofi = getLofiSession(voiceChannel.guild.id);
    throw new Error(
      lofi
        ? `Lofi radio is playing in <#${lofi.voiceChannelId}>. Stop it before starting a meeting recording.`
        : "Lofi radio is playing in this server. Stop it before starting a meeting recording.",
    );
  }

  if (!client.user) {
    throw new Error("Bot is not ready yet.");
  }

  const recordChannel = resolveMeetingRecordChannel(voiceChannel);
  const workDir = createWorkDir(voiceChannel.guild.id, voiceChannel.id);
  const pcmPath = path.join(workDir, "meeting.pcm");
  const mixer = new PcmMixer(pcmPath);

  let connection: VoiceConnection;
  try {
    connection = await joinVoiceChannelReady(voiceChannel, {
      selfDeaf: false,
      selfMute: true,
    });
  } catch (error) {
    await mixer.close().catch(() => undefined);
    await fs.promises
      .rm(workDir, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }

  const session: MeetingRecordingSession = {
    voiceChannelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    categoryId: voiceChannel.parentId,
    recordChannelId: recordChannel.id,
    starterId,
    startedAt: new Date(),
    status: "recording",
    connection,
    mixer,
    pcmPath,
    workDir,
    emptyTimer: null,
    activeSpeakers: new Set(),
  };

  sessions.set(voiceChannel.id, session);

  const botUserId = client.user.id;
  connection.receiver.speaking.on("start", (userId) => {
    subscribeSpeaker(session, userId, botUserId);
  });

  connection.on("stateChange", (_old, next) => {
    if (
      next.status === VoiceConnectionStatus.Destroyed ||
      next.status === VoiceConnectionStatus.Disconnected
    ) {
      if (sessions.get(voiceChannel.id) === session && session.status !== "stopping") {
        void stopRecording({
          client,
          voiceChannelId: voiceChannel.id,
          reason: "Voice connection lost: saving recording.",
        }).catch((error) => {
          console.error(
            "[meeting] Failed to stop after voice loss:",
            error,
          );
        });
      }
    }
  });

  // If channel already empty of humans somehow, arm timer
  armOrClearEmptyTimer(client, session, voiceChannel);

  return session;
}

export function pauseRecording(voiceChannelId: string): MeetingRecordingSession {
  const session = sessions.get(voiceChannelId);
  if (!session) throw new Error("No active recording in that voice channel.");
  if (session.status === "paused") throw new Error("Recording is already paused.");
  if (session.status !== "recording") {
    throw new Error("Recording cannot be paused in its current state.");
  }

  session.status = "paused";
  session.mixer.pause();
  return session;
}

export function resumeRecording(voiceChannelId: string): MeetingRecordingSession {
  const session = sessions.get(voiceChannelId);
  if (!session) throw new Error("No active recording in that voice channel.");
  if (session.status === "recording") {
    throw new Error("Recording is already in progress.");
  }
  if (session.status !== "paused") {
    throw new Error("Recording cannot be resumed in its current state.");
  }

  session.status = "recording";
  session.mixer.resume();
  return session;
}

export async function stopRecording(options: {
  client: Client;
  voiceChannelId: string;
  reason?: string;
}): Promise<{
  durationMs: number;
  messageUrl: string | null;
  bitrateKbps: number;
}> {
  const session = sessions.get(options.voiceChannelId);
  if (!session) {
    throw new Error("No active recording in that voice channel.");
  }
  if (session.status === "stopping") {
    throw new Error("Recording is already stopping.");
  }

  session.status = "stopping";
  if (session.emptyTimer) {
    clearTimeout(session.emptyTimer);
    session.emptyTimer = null;
  }

  // Remove from map early so concurrent stops fail cleanly
  sessions.delete(options.voiceChannelId);

  const durationMs = session.mixer.durationMs;

  try {
    await session.mixer.close();
  } catch (error) {
    console.error("[meeting] mixer close error:", error);
  }

  try {
    const existing = getVoiceConnection(session.guildId);
    if (existing === session.connection) {
      existing.destroy();
    } else {
      session.connection.destroy();
    }
  } catch (error) {
    console.error("[meeting] voice destroy error:", error);
  }

  let messageUrl: string | null = null;
  let bitrateKbps = 0;

  try {
    const pcmStat = await fs.promises.stat(session.pcmPath).catch(() => null);
    if (!pcmStat || pcmStat.size < BYTES_MIN_PCM) {
      const channel = await fetchRecordChannel(options.client, session);
      if (channel) {
        const embed = new EmbedBuilder()
          .setColor(0xf85149)
          .setTitle("Meeting recording discarded")
          .setDescription(
            options.reason ??
              "Recording was too short or empty — nothing was uploaded.",
          )
          .addFields(
            { name: "Duration", value: formatDuration(durationMs), inline: true },
            {
              name: "Voice channel",
              value: `<#${session.voiceChannelId}>`,
              inline: true,
            },
          )
          .setTimestamp(new Date());
        const msg = await channel.send({ embeds: [embed] });
        messageUrl = msg.url;
      }
    } else {
      const baseName = `meeting-${session.voiceChannelId}-${session.startedAt
        .toISOString()
        .replace(/[:.]/g, "-")}`;
      const compressed = await compressMeetingPcm(
        session.pcmPath,
        session.workDir,
        baseName,
      );
      bitrateKbps = compressed.bitrateKbps;

      const channel = await fetchRecordChannel(options.client, session);
      if (!channel) {
        throw new Error("Could not find the meeting-record channel to upload to.");
      }

      const partCount = compressed.parts.length;
      const embed = new EmbedBuilder()
        .setColor(0x238636)
        .setTitle(
          partCount > 1
            ? `Meeting recording saved (${partCount} parts)`
            : "Meeting recording saved",
        )
        .setDescription(
          options.reason ??
            "Recording stopped and compressed for archival.",
        )
        .addFields(
          { name: "Duration", value: formatDuration(durationMs), inline: true },
          {
            name: "Bitrate",
            value: `${compressed.bitrateKbps} kbps Opus`,
            inline: true,
          },
          {
            name: "Voice channel",
            value: `<#${session.voiceChannelId}>`,
            inline: true,
          },
          {
            name: "Started by",
            value: `<@${session.starterId}>`,
            inline: true,
          },
          ...(partCount > 1
            ? [
                {
                  name: "Parts",
                  value: `${partCount} files (split to fit upload limit)`,
                  inline: true,
                },
              ]
            : []),
        )
        .setTimestamp(new Date());

      const first = compressed.parts[0]!;
      const firstFile = new AttachmentBuilder(first.outputPath, {
        name: path.basename(first.outputPath),
      });
      const msg = await channel.send({
        embeds: [embed],
        files: [firstFile],
      });
      messageUrl = msg.url;

      for (const part of compressed.parts.slice(1)) {
        const file = new AttachmentBuilder(part.outputPath, {
          name: path.basename(part.outputPath),
        });
        await channel.send({
          content: `Meeting recording part **${part.index}/${part.total}**`,
          files: [file],
        });
      }
    }
  } finally {
    await fs.promises
      .rm(session.workDir, { recursive: true, force: true })
      .catch(() => undefined);
  }

  return { durationMs, messageUrl, bitrateKbps };
}

const BYTES_MIN_PCM = 48_000 * 2 * 2 * 1; // ~1s of stereo s16le

async function fetchRecordChannel(
  client: Client,
  session: MeetingRecordingSession,
): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(session.recordChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
  return channel as GuildTextBasedChannel;
}

export function armOrClearEmptyTimer(
  client: Client,
  session: MeetingRecordingSession,
  voiceChannel: VoiceBasedChannel,
): void {
  const humans = countHumansInVoice(voiceChannel);

  if (humans > 0) {
    if (session.emptyTimer) {
      clearTimeout(session.emptyTimer);
      session.emptyTimer = null;
    }
    return;
  }

  if (session.emptyTimer || session.status === "stopping") return;

  session.emptyTimer = setTimeout(() => {
    session.emptyTimer = null;
    if (!sessions.has(session.voiceChannelId)) return;
    void stopRecording({
      client,
      voiceChannelId: session.voiceChannelId,
      reason:
        "Auto-stopped: no one was in the meeting voice channel for 3 minutes.",
    }).catch((error) => {
      console.error("[meeting] auto-stop failed:", error);
    });
  }, EMPTY_STOP_MS);
}

export function handleVoiceStateForSessions(
  client: Client,
  channel: VoiceBasedChannel | null,
): void {
  if (!channel) return;
  const session = sessions.get(channel.id);
  if (!session) return;
  armOrClearEmptyTimer(client, session, channel);
}

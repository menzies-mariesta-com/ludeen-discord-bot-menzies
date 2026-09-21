import type { Client, VoiceBasedChannel } from "discord.js";
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import { config } from "../config";
import { countHumansInVoice } from "../meeting/permissions";
import { joinVoiceChannelReady } from "../voice/join";
import {
  createLofiPlayer,
  nextStreamIndex,
  playStreamUrl,
  streamLabel,
} from "./player";

const EMPTY_STOP_MS = 3 * 60 * 1000;

export type LofiStatus = "playing" | "paused" | "stopping";

export interface LofiSession {
  guildId: string;
  voiceChannelId: string;
  starterId: string;
  startedAt: Date;
  status: LofiStatus;
  connection: VoiceConnection;
  player: AudioPlayer;
  urlIndex: number;
  emptyTimer: NodeJS.Timeout | null;
}

const sessions = new Map<string, LofiSession>();

export function getLofiSession(guildId: string): LofiSession | undefined {
  return sessions.get(guildId);
}

export function hasActiveLofiInGuild(guildId: string): boolean {
  return sessions.has(guildId);
}

export function listLofiSessions(): LofiSession[] {
  return [...sessions.values()];
}

function currentUrl(session: LofiSession): string {
  return config.lofiStreamUrls[session.urlIndex] ?? config.lofiStreamUrls[0]!;
}

export function getCurrentStreamLabel(session: LofiSession): string {
  return streamLabel(currentUrl(session));
}

function attachIdleRotation(session: LofiSession): void {
  session.player.on(AudioPlayerStatus.Idle, () => {
    if (session.status !== "playing") return;
    if (!sessions.has(session.guildId)) return;

    session.urlIndex = nextStreamIndex(session.urlIndex);
    try {
      playStreamUrl(session.player, currentUrl(session));
      console.log(
        `[lofi] Rotated stream in guild ${session.guildId} → ${getCurrentStreamLabel(session)}`,
      );
    } catch (error) {
      console.error("[lofi] Failed to rotate stream:", error);
    }
  });

  session.player.on("error", (error) => {
    console.error("[lofi] Player error:", error.message);
    if (session.status !== "playing") return;
    // Try next URL after a brief failure
    session.urlIndex = nextStreamIndex(session.urlIndex);
    try {
      playStreamUrl(session.player, currentUrl(session));
    } catch (err) {
      console.error("[lofi] Failed to recover stream:", err);
    }
  });
}

export async function startLofi(options: {
  client: Client;
  voiceChannel: VoiceBasedChannel;
  starterId: string;
}): Promise<LofiSession> {
  const { voiceChannel, starterId } = options;
  const guildId = voiceChannel.guild.id;

  if (sessions.has(guildId)) {
    const existing = sessions.get(guildId)!;
    throw new Error(
      `Lofi radio is already playing in <#${existing.voiceChannelId}>. Stop it first.`,
    );
  }

  const { hasActiveMeetingInGuild } = await import("../meeting/sessionManager");
  if (hasActiveMeetingInGuild(guildId)) {
    const meeting = (
      await import("../meeting/sessionManager")
    ).listGuildSessions(guildId)[0];
    throw new Error(
      meeting
        ? `A meeting is being recorded in <#${meeting.voiceChannelId}>. Stop it before starting lofi.`
        : "A meeting recording is active in this server. Stop it before starting lofi.",
    );
  }

  // Start on a random index so restarts feel fresh when multiple URLs exist
  const urlIndex =
    config.lofiStreamUrls.length > 1
      ? Math.floor(Math.random() * config.lofiStreamUrls.length)
      : 0;

  const player = createLofiPlayer();
  let connection: VoiceConnection;
  try {
    connection = await joinVoiceChannelReady(voiceChannel, {
      selfDeaf: true,
      selfMute: false,
    });
  } catch (error) {
    player.stop(true);
    throw error;
  }

  connection.subscribe(player);

  const session: LofiSession = {
    guildId,
    voiceChannelId: voiceChannel.id,
    starterId,
    startedAt: new Date(),
    status: "playing",
    connection,
    player,
    urlIndex,
    emptyTimer: null,
  };

  sessions.set(guildId, session);
  attachIdleRotation(session);

  try {
    playStreamUrl(player, currentUrl(session));
  } catch (error) {
    sessions.delete(guildId);
    player.stop(true);
    connection.destroy();
    throw error instanceof Error
      ? error
      : new Error("Failed to start lofi stream.");
  }

  connection.on("stateChange", (_old, next) => {
    if (
      next.status === VoiceConnectionStatus.Destroyed ||
      next.status === VoiceConnectionStatus.Disconnected
    ) {
      if (sessions.get(guildId) === session && session.status !== "stopping") {
        void stopLofi({
          guildId,
          reason: "Voice connection lost.",
        });
      }
    }
  });

  armOrClearLofiEmptyTimer(options.client, session, voiceChannel);

  return session;
}

export function pauseLofi(guildId: string): LofiSession {
  const session = sessions.get(guildId);
  if (!session) throw new Error("No lofi radio is playing in this server.");
  if (session.status === "paused") throw new Error("Lofi is already paused.");
  if (session.status !== "playing") {
    throw new Error("Lofi cannot be paused in its current state.");
  }

  session.player.pause(true);
  session.status = "paused";
  return session;
}

export function resumeLofi(guildId: string): LofiSession {
  const session = sessions.get(guildId);
  if (!session) throw new Error("No lofi radio is playing in this server.");
  if (session.status === "playing") {
    throw new Error("Lofi is already playing.");
  }
  if (session.status !== "paused") {
    throw new Error("Lofi cannot be resumed in its current state.");
  }

  const ok = session.player.unpause();
  if (!ok) {
    // Resource may have ended while paused — kick the next stream
    session.urlIndex = nextStreamIndex(session.urlIndex);
    playStreamUrl(session.player, currentUrl(session));
  }
  session.status = "playing";
  return session;
}

export async function stopLofi(options: {
  guildId: string;
  reason?: string;
}): Promise<void> {
  const session = sessions.get(options.guildId);
  if (!session) {
    throw new Error("No lofi radio is playing in this server.");
  }
  if (session.status === "stopping") return;

  session.status = "stopping";
  if (session.emptyTimer) {
    clearTimeout(session.emptyTimer);
    session.emptyTimer = null;
  }

  sessions.delete(options.guildId);

  try {
    session.player.stop(true);
  } catch (error) {
    console.error("[lofi] player stop error:", error);
  }

  try {
    session.connection.destroy();
  } catch (error) {
    console.error("[lofi] connection destroy error:", error);
  }

  if (options.reason) {
    console.log(`[lofi] Stopped in guild ${options.guildId}: ${options.reason}`);
  }
}

export function armOrClearLofiEmptyTimer(
  _client: Client,
  session: LofiSession,
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
    if (!sessions.has(session.guildId)) return;
    void stopLofi({
      guildId: session.guildId,
      reason:
        "Auto-stopped: no one was in the voice channel for 3 minutes.",
    }).catch((error) => {
      console.error("[lofi] auto-stop failed:", error);
    });
  }, EMPTY_STOP_MS);
}

export function handleVoiceStateForLofi(
  client: Client,
  channel: VoiceBasedChannel | null,
): void {
  if (!channel) return;
  const session = sessions.get(channel.guild.id);
  if (!session) return;
  if (session.voiceChannelId !== channel.id) return;
  armOrClearLofiEmptyTimer(client, session, channel);
}

import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../../types/command";
import { isMeetingVoiceChannel } from "../../meeting/channels";
import { canControlRecording } from "../../meeting/permissions";
import {
  getSession,
  getSessionForMemberVoice,
  listGuildSessions,
  pauseRecording,
  resumeRecording,
  startRecording,
  stopRecording,
} from "../../meeting/sessionManager";

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("meeting")
    .setDescription("Meeting voice recording")
    .addSubcommandGroup((group) =>
      group
        .setName("record")
        .setDescription("Record a meeting voice channel")
        .addSubcommand((sub) =>
          sub
            .setName("start")
            .setDescription(
              "Start recording the meeting voice channel you are in",
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("pause")
            .setDescription("Pause the current meeting recording"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("resume")
            .setDescription("Resume a paused meeting recording"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("stop")
            .setDescription(
              "Stop recording, compress audio, and post to meeting-record",
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("status")
            .setDescription("Show recording status for this guild"),
        ),
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(true);
    const sub = interaction.options.getSubcommand(true);

    if (group !== "record") return;

    try {
      if (!interaction.guild || !interaction.member) {
        await interaction.reply({
          content: "This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (sub === "status") {
        const sessions = listGuildSessions(interaction.guild.id);
        if (sessions.length === 0) {
          await interaction.reply({
            content: "No active meeting recordings in this server.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0x58a6ff)
          .setTitle("Active meeting recordings")
          .setDescription(
            sessions
              .map((s) => {
                const age = formatDuration(Date.now() - s.startedAt.getTime());
                const captured = formatDuration(s.mixer.durationMs);
                return (
                  `• <#${s.voiceChannelId}> — **${s.status}** · captured ${captured} · started ${age} ago by <@${s.starterId}>`
                );
              })
              .join("\n"),
          );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === "start") {
        await interaction.deferReply();

        const voiceChannel = member.voice.channel;
        if (!voiceChannel || voiceChannel.type === ChannelType.GuildStageVoice) {
          await interaction.editReply(
            "Join a **meeting*** voice channel first, then run `/meeting record start`.",
          );
          return;
        }

        if (!isMeetingVoiceChannel(voiceChannel)) {
          await interaction.editReply(
            "You must be in a voice channel whose name starts with `meeting` (e.g. `meeting`, `meeting-standup`).",
          );
          return;
        }

        if (getSession(voiceChannel.id)) {
          await interaction.editReply(
            "This meeting channel is already being recorded. Use `/meeting record status`.",
          );
          return;
        }

        const session = await startRecording({
          client: interaction.client,
          voiceChannel,
          starterId: interaction.user.id,
        });

        const embed = new EmbedBuilder()
          .setColor(0x238636)
          .setTitle("Recording started")
          .setDescription(
            `Recording <#${session.voiceChannelId}>. Audio will be posted to <#${session.recordChannelId}> when stopped.`,
          )
          .addFields({
            name: "Controls",
            value:
              "`/meeting record pause` · `resume` · `stop`\nAuto-stops after **3 minutes** empty.",
          });

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // pause / resume / stop need an active session for the member's VC
      const voiceChannelId = member.voice.channelId;
      const session = getSessionForMemberVoice(voiceChannelId);

      if (!session) {
        await interaction.reply({
          content:
            "No active recording for the voice channel you are in. Start one with `/meeting record start`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!canControlRecording(member, session.starterId)) {
        await interaction.reply({
          content:
            "Only the person who started this recording, members with **Manage Channels**, or the **Meeting Recorder** role can control it.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === "pause") {
        pauseRecording(session.voiceChannelId);
        await interaction.reply({
          content: `Paused recording in <#${session.voiceChannelId}>.`,
        });
        return;
      }

      if (sub === "resume") {
        resumeRecording(session.voiceChannelId);
        await interaction.reply({
          content: `Resumed recording in <#${session.voiceChannelId}>.`,
        });
        return;
      }

      if (sub === "stop") {
        await interaction.deferReply();
        const result = await stopRecording({
          client: interaction.client,
          voiceChannelId: session.voiceChannelId,
          reason: `Stopped by <@${interaction.user.id}>.`,
        });

        await interaction.editReply({
          content: result.messageUrl
            ? `Recording saved (${formatDuration(result.durationMs)}). ${result.messageUrl}`
            : `Recording finished (${formatDuration(result.durationMs)}).`,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Meeting command failed.";

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};

export default command;

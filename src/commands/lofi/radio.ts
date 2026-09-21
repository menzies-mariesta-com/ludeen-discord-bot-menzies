import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../../types/command";
import { canControlRecording } from "../../meeting/permissions";
import {
  getCurrentStreamLabel,
  getLofiSession,
  pauseLofi,
  resumeLofi,
  startLofi,
  stopLofi,
} from "../../lofi/sessionManager";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("lofi")
    .setDescription("Focus lofi radio in a voice channel")
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Play continuous lofi in the voice channel you are in"),
    )
    .addSubcommand((sub) =>
      sub.setName("pause").setDescription("Pause lofi radio"),
    )
    .addSubcommand((sub) =>
      sub.setName("resume").setDescription("Resume lofi radio"),
    )
    .addSubcommand((sub) =>
      sub.setName("stop").setDescription("Stop lofi radio and leave the voice channel"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show lofi radio status for this server"),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);

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
        const session = getLofiSession(interaction.guild.id);
        if (!session) {
          await interaction.reply({
            content: "No lofi radio is playing in this server.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0xc4a484)
          .setTitle("Lofi radio")
          .addFields(
            {
              name: "Channel",
              value: `<#${session.voiceChannelId}>`,
              inline: true,
            },
            { name: "State", value: session.status, inline: true },
            {
              name: "Stream",
              value: `\`${getCurrentStreamLabel(session)}\``,
            },
            {
              name: "Started by",
              value: `<@${session.starterId}>`,
              inline: true,
            },
          )
          .setTimestamp(session.startedAt);

        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === "start") {
        await interaction.deferReply();

        const voiceChannel = member.voice.channel;
        if (!voiceChannel || voiceChannel.type === ChannelType.GuildStageVoice) {
          await interaction.editReply(
            "Join a voice channel first, then run `/lofi start`.",
          );
          return;
        }

        const session = await startLofi({
          client: interaction.client,
          voiceChannel,
          starterId: interaction.user.id,
        });

        const embed = new EmbedBuilder()
          .setColor(0xc4a484)
          .setTitle("Lofi radio started")
          .setDescription(
            `Playing in <#${session.voiceChannelId}> — stay focused.\nAuto-stops after **3 minutes** empty.`,
          )
          .addFields({
            name: "Stream",
            value: `\`${getCurrentStreamLabel(session)}\``,
          })
          .addFields({
            name: "Controls",
            value: "`/lofi pause` · `resume` · `stop`",
          });

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const session = getLofiSession(interaction.guild.id);
      if (!session) {
        await interaction.reply({
          content: "No lofi radio is playing. Start one with `/lofi start`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!canControlRecording(member, session.starterId)) {
        await interaction.reply({
          content:
            "Only the person who started lofi, members with **Manage Channels**, or the **Meeting Recorder** role can control it.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === "pause") {
        pauseLofi(interaction.guild.id);
        await interaction.reply({
          content: `Paused lofi in <#${session.voiceChannelId}>.`,
        });
        return;
      }

      if (sub === "resume") {
        resumeLofi(interaction.guild.id);
        await interaction.reply({
          content: `Resumed lofi in <#${session.voiceChannelId}>.`,
        });
        return;
      }

      if (sub === "stop") {
        await stopLofi({
          guildId: interaction.guild.id,
          reason: `Stopped by ${interaction.user.tag}`,
        });
        await interaction.reply({
          content: `Stopped lofi and left <#${session.voiceChannelId}>.`,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Lofi command failed.";

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

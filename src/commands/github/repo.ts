import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import type { SlashCommand } from "../../types/command";
import {
  listMappedRepos,
  resolveRepoForChannel,
  UnmappedChannelError,
} from "../../github/repos";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("repo")
    .setDescription("Show which GitHub repo this Discord channel targets")
    .addSubcommand((sub) =>
      sub
        .setName("here")
        .setDescription("Show the GitHub repo mapped to this channel"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List all channel → repo mappings"),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "here") {
      try {
        const repo = resolveRepoForChannel(interaction.channelId);
        const embed = new EmbedBuilder()
          .setColor(0x58a6ff)
          .setTitle("Channel → GitHub repo")
          .addFields(
            {
              name: "Channel",
              value: `<#${interaction.channelId}>`,
              inline: true,
            },
            {
              name: "Repo",
              value: `[${repo.fullName}](https://github.com/${repo.fullName})`,
              inline: true,
            },
          );

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        const message =
          error instanceof UnmappedChannelError
            ? error.message
            : "Failed to resolve repo for this channel.";

        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (sub === "list") {
      const mappings = listMappedRepos();

      if (mappings.length === 0) {
        await interaction.reply({
          content:
            "No channel → repo mappings configured. Set `GITHUB_REPO_MAP` in `.env`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x58a6ff)
        .setTitle("GitHub repo mappings")
        .setDescription(
          mappings
            .map(
              (m) =>
                `<#${m.channelId}> → [${m.fullName}](https://github.com/${m.fullName})`,
            )
            .join("\n"),
        );

      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default command;

import {
  SlashCommandBuilder,
  MessageFlags,
  channelMention,
} from "discord.js";
import type { SlashCommand } from "../../types/command";
import { openOrRefreshTaskBoard } from "../../github/taskBoard";
import { getGithubUsername } from "../../github/links";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("tasks")
    .setDescription("Your private assigned-task board")
    .addSubcommand((sub) =>
      sub
        .setName("open")
        .setDescription(
          "Open (or create) your private task thread and load assigned issues",
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("refresh")
        .setDescription("Refresh the timeline in your private task thread"),
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const linked = await getGithubUsername(interaction.user.id);
      if (!linked) {
        await interaction.editReply(
          "Link your GitHub account first: `/link github username:yourname`.",
        );
        return;
      }

      if (!interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.editReply(
          "Run this command inside a text channel.",
        );
        return;
      }

      if (interaction.channel.isDMBased() || interaction.channel.isThread()) {
        await interaction.editReply(
          "Run `/tasks open` from a normal server text channel (not a thread or DM).",
        );
        return;
      }

      const result = await openOrRefreshTaskBoard(
        interaction.client,
        interaction.user.id,
        interaction.channel,
      );

      const action = result.created ? "Created" : "Updated";
      await interaction.editReply(
        `${action} your private task board in ${channelMention(result.threadId)} — **${result.issueCount}** open assigned issue(s) across mapped repos.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to open/refresh your task board.";

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

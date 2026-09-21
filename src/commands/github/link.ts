import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { SlashCommand } from "../../types/command";
import {
  getGithubUsername,
  linkGithubAccount,
  unlinkGithubAccount,
} from "../../github/links";
import { octokit } from "../../github/client";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord account to GitHub")
    .addSubcommand((sub) =>
      sub
        .setName("github")
        .setDescription("Link a GitHub username to your Discord account")
        .addStringOption((opt) =>
          opt
            .setName("username")
            .setDescription("Your GitHub username")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show your linked GitHub username"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("unlink")
        .setDescription("Remove your GitHub link"),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === "github") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const username = interaction.options
          .getString("username", true)
          .replace(/^@/, "");

        try {
          await octokit.users.getByUsername({ username });
        } catch {
          await interaction.editReply(
            `GitHub user **${username}** was not found.`,
          );
          return;
        }

        await linkGithubAccount(interaction.user.id, username);
        await interaction.editReply(
          `Linked to **@${username.toLowerCase()}**. Open your board with \`/tasks open\`.`,
        );
        return;
      }

      if (sub === "status") {
        const linked = await getGithubUsername(interaction.user.id);
        await interaction.reply({
          content: linked
            ? `You are linked as **@${linked}**.`
            : "You have no GitHub link. Use `/link github username:yourname`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === "unlink") {
        const removed = await unlinkGithubAccount(interaction.user.id);
        await interaction.reply({
          content: removed
            ? "GitHub link removed."
            : "You had no GitHub link.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update link.";
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

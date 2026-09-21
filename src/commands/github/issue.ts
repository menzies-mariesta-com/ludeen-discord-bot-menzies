import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import type { SlashCommand } from "../../types/command";
import { octokit } from "../../github/client";
import {
  resolveRepoForChannel,
  UnmappedChannelError,
} from "../../github/repos";
import { refreshBoardsForGithubUsers } from "../../github/taskBoard";

function parseCsv(value: string | null): string[] | undefined {
  if (!value?.trim()) return undefined;
  const items = value
    .split(",")
    .map((part) => part.trim().replace(/^@/, ""))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function formatAssignees(
  assignees: Array<{ login?: string | null } | null> | null | undefined,
): string {
  if (!assignees?.length) return "—";
  return assignees
    .map((a) => (a?.login ? `@${a.login}` : null))
    .filter(Boolean)
    .join(", ") || "—";
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("issue")
    .setDescription("Manage GitHub issues for this channel's repo")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a GitHub issue")
        .addStringOption((opt) =>
          opt.setName("title").setDescription("Issue title").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("body")
            .setDescription("Issue body / description")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("assignees")
            .setDescription(
              "GitHub usernames to assign (comma-separated, e.g. alice,bob)",
            )
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("labels")
            .setDescription("Comma-separated labels (must already exist)")
            .setRequired(false),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("milestone")
            .setDescription("Milestone number")
            .setMinValue(1)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit an existing GitHub issue")
        .addIntegerOption((opt) =>
          opt
            .setName("number")
            .setDescription("Issue number")
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((opt) =>
          opt.setName("title").setDescription("New title").setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("body")
            .setDescription("New body / description")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("assignees")
            .setDescription(
              "Replace assignees with these GitHub usernames (comma-separated)",
            )
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("labels")
            .setDescription(
              "Replace labels with these (comma-separated, must already exist)",
            )
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("state")
            .setDescription("Issue state")
            .addChoices(
              { name: "open", value: "open" },
              { name: "closed", value: "closed" },
            )
            .setRequired(false),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("milestone")
            .setDescription("Milestone number (use 0 to clear)")
            .setMinValue(0)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List open GitHub issues")
        .addIntegerOption((opt) =>
          opt
            .setName("limit")
            .setDescription("How many issues to show (max 20)")
            .setMinValue(1)
            .setMaxValue(20)
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("assignee")
            .setDescription("Filter by GitHub username (or none / *)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View a GitHub issue by number")
        .addIntegerOption((opt) =>
          opt
            .setName("number")
            .setDescription("Issue number")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("close")
        .setDescription("Close a GitHub issue")
        .addIntegerOption((opt) =>
          opt
            .setName("number")
            .setDescription("Issue number")
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((opt) =>
          opt
            .setName("comment")
            .setDescription("Optional closing comment")
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channelId;

    try {
      const repo = resolveRepoForChannel(channelId);

      if (sub === "create") {
        await interaction.deferReply();
        const title = interaction.options.getString("title", true);
        const body = interaction.options.getString("body") ?? undefined;
        const labels = parseCsv(interaction.options.getString("labels"));
        const assignees = parseCsv(interaction.options.getString("assignees"));
        const milestone = interaction.options.getInteger("milestone") ?? undefined;

        const reporter = interaction.user.tag;
        const issueBody = [
          body ?? "",
          "",
          `---`,
          `_Opened via Discord by **${reporter}** in channel \`${channelId}\`_`,
        ]
          .join("\n")
          .trim();

        const { data: issue } = await octokit.issues.create({
          owner: repo.owner,
          repo: repo.repo,
          title,
          body: issueBody,
          labels,
          assignees,
          milestone,
        });

        const embed = new EmbedBuilder()
          .setColor(0x238636)
          .setTitle(`Issue #${issue.number} created`)
          .setURL(issue.html_url)
          .setDescription(title)
          .addFields(
            { name: "Repo", value: repo.fullName, inline: true },
            {
              name: "Assignees",
              value: formatAssignees(issue.assignees),
              inline: true,
            },
          )
          .setFooter({ text: "GitHub" });

        if (labels?.length) {
          embed.addFields({
            name: "Labels",
            value: labels.join(", "),
            inline: true,
          });
        }

        await interaction.editReply({ embeds: [embed] });

        if (assignees?.length) {
          void refreshBoardsForGithubUsers(interaction.client, assignees);
        }
        return;
      }

      if (sub === "edit") {
        await interaction.deferReply();
        const number = interaction.options.getInteger("number", true);
        const title = interaction.options.getString("title") ?? undefined;
        const body = interaction.options.getString("body") ?? undefined;
        const labels = parseCsv(interaction.options.getString("labels"));
        const assignees = parseCsv(interaction.options.getString("assignees"));
        const state = interaction.options.getString("state") as
          | "open"
          | "closed"
          | null;
        const milestoneRaw = interaction.options.getInteger("milestone");

        if (
          title === undefined &&
          body === undefined &&
          labels === undefined &&
          assignees === undefined &&
          !state &&
          milestoneRaw === null
        ) {
          await interaction.editReply(
            "Provide at least one field to update: `title`, `body`, `assignees`, `labels`, `state`, or `milestone`.",
          );
          return;
        }

        const { data: issue } = await octokit.issues.update({
          owner: repo.owner,
          repo: repo.repo,
          issue_number: number,
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(labels !== undefined ? { labels } : {}),
          ...(assignees !== undefined ? { assignees } : {}),
          ...(state ? { state } : {}),
          ...(milestoneRaw !== null
            ? { milestone: milestoneRaw === 0 ? null : milestoneRaw }
            : {}),
        });

        const embed = new EmbedBuilder()
          .setColor(issue.state === "open" ? 0x238636 : 0xda3633)
          .setTitle(`Issue #${issue.number} updated`)
          .setURL(issue.html_url)
          .setDescription(issue.title)
          .addFields(
            { name: "Repo", value: repo.fullName, inline: true },
            { name: "State", value: issue.state, inline: true },
            {
              name: "Assignees",
              value: formatAssignees(issue.assignees),
              inline: true,
            },
          )
          .setFooter({
            text: `Edited via Discord by ${interaction.user.tag}`,
          });

        await interaction.editReply({ embeds: [embed] });

        if (assignees?.length) {
          void refreshBoardsForGithubUsers(interaction.client, assignees);
        }
        return;
      }

      if (sub === "list") {
        await interaction.deferReply();
        const limit = interaction.options.getInteger("limit") ?? 10;
        const assigneeFilter = interaction.options.getString("assignee");

        const { data: issues } = await octokit.issues.listForRepo({
          owner: repo.owner,
          repo: repo.repo,
          state: "open",
          per_page: limit,
          sort: "created",
          direction: "desc",
          ...(assigneeFilter
            ? { assignee: assigneeFilter.replace(/^@/, "") }
            : {}),
        });

        const onlyIssues = issues.filter((i) => !i.pull_request);

        if (onlyIssues.length === 0) {
          await interaction.editReply(
            `No open issues in **${repo.fullName}**.`,
          );
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0x58a6ff)
          .setTitle(`Open issues — ${repo.fullName}`)
          .setDescription(
            onlyIssues
              .map((i) => {
                const who = formatAssignees(i.assignees);
                const assigneeNote = who === "—" ? "" : ` · ${who}`;
                return `**[#${i.number}](${i.html_url})** ${i.title}${assigneeNote}`;
              })
              .join("\n"),
          );

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === "view") {
        await interaction.deferReply();
        const number = interaction.options.getInteger("number", true);

        const { data: issue } = await octokit.issues.get({
          owner: repo.owner,
          repo: repo.repo,
          issue_number: number,
        });

        const embed = new EmbedBuilder()
          .setColor(issue.state === "open" ? 0x238636 : 0xda3633)
          .setTitle(`#${issue.number} ${issue.title}`)
          .setURL(issue.html_url)
          .setDescription(
            (issue.body && issue.body.length > 1500
              ? `${issue.body.slice(0, 1500)}…`
              : issue.body) || "_No description_",
          )
          .addFields(
            { name: "State", value: issue.state, inline: true },
            { name: "Repo", value: repo.fullName, inline: true },
            {
              name: "Author",
              value: issue.user?.login ?? "unknown",
              inline: true,
            },
            {
              name: "Assignees",
              value: formatAssignees(issue.assignees),
              inline: true,
            },
          );

        if (issue.labels.length > 0) {
          embed.addFields({
            name: "Labels",
            value: issue.labels
              .map((l) => (typeof l === "string" ? l : l.name))
              .filter(Boolean)
              .join(", "),
          });
        }

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === "close") {
        await interaction.deferReply();
        const number = interaction.options.getInteger("number", true);
        const comment = interaction.options.getString("comment");

        if (comment) {
          await octokit.issues.createComment({
            owner: repo.owner,
            repo: repo.repo,
            issue_number: number,
            body: `${comment}\n\n_Closed via Discord by **${interaction.user.tag}**_`,
          });
        }

        const { data: issue } = await octokit.issues.update({
          owner: repo.owner,
          repo: repo.repo,
          issue_number: number,
          state: "closed",
        });

        const embed = new EmbedBuilder()
          .setColor(0xda3633)
          .setTitle(`Issue #${issue.number} closed`)
          .setURL(issue.html_url)
          .setDescription(issue.title)
          .addFields({ name: "Repo", value: repo.fullName, inline: true });

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      const message =
        error instanceof UnmappedChannelError
          ? error.message
          : error instanceof Error
            ? `GitHub error: ${error.message}`
            : "Something went wrong talking to GitHub.";

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message });
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

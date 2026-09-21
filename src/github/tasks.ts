import { EmbedBuilder } from "discord.js";
import { config } from "../config";
import { octokit, parseRepoRef } from "./client";

export interface AssignedIssue {
  number: number;
  title: string;
  htmlUrl: string;
  repoFullName: string;
  createdAt: string | null;
  updatedAt: string | null;
  labels: string[];
}

function uniqueMappedRepos(): string[] {
  return [...new Set(Object.values(config.githubRepoMap))];
}

/** Fetch open issues assigned to a GitHub user across all mapped repos. */
export async function fetchAssignedIssues(
  githubUsername: string,
): Promise<AssignedIssue[]> {
  const username = githubUsername.replace(/^@/, "");
  const repos = uniqueMappedRepos();
  const results: AssignedIssue[] = [];

  await Promise.all(
    repos.map(async (fullName) => {
      const { owner, repo } = parseRepoRef(fullName);
      try {
        const { data } = await octokit.issues.listForRepo({
          owner,
          repo,
          state: "open",
          assignee: username,
          per_page: 50,
          sort: "updated",
          direction: "desc",
        });

        for (const issue of data) {
          if (issue.pull_request) continue;
          results.push({
            number: issue.number,
            title: issue.title,
            htmlUrl: issue.html_url,
            repoFullName: fullName,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            labels: issue.labels
              .map((l) => (typeof l === "string" ? l : l.name))
              .filter((l): l is string => Boolean(l)),
          });
        }
      } catch (error) {
        console.error(
          `[tasks] Failed to list issues for ${fullName} assignee=${username}:`,
          error,
        );
      }
    }),
  );

  results.sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime;
  });

  return results;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - Date.parse(iso);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function timelineBucket(iso: string | null): string {
  if (!iso) return "Earlier";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days <= 7) return "This week";
  if (days <= 30) return "This month";
  return "Earlier";
}

const BUCKET_ORDER = ["Today", "This week", "This month", "Earlier"] as const;

export function buildTaskBoardEmbed(
  githubUsername: string,
  issues: AssignedIssue[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x58a6ff)
    .setTitle(`Task board — @${githubUsername}`)
    .setFooter({
      text: "Assigned open issues across all mapped repos · updates on /tasks refresh",
    })
    .setTimestamp(new Date());

  if (issues.length === 0) {
    embed.setDescription(
      `No open issues assigned to **@${githubUsername}** in mapped repos.`,
    );
    return embed;
  }

  const grouped = new Map<string, AssignedIssue[]>();
  for (const issue of issues) {
    const bucket = timelineBucket(issue.updatedAt);
    const list = grouped.get(bucket) ?? [];
    list.push(issue);
    grouped.set(bucket, list);
  }

  const lines: string[] = [];
  for (const bucket of BUCKET_ORDER) {
    const list = grouped.get(bucket);
    if (!list?.length) continue;
    lines.push(`**${bucket}**`);
    for (const issue of list.slice(0, 15)) {
      const when = formatRelative(issue.updatedAt);
      const labels =
        issue.labels.length > 0
          ? ` · \`${issue.labels.slice(0, 3).join("`, `")}\``
          : "";
      lines.push(
        `• [#${issue.number}](${issue.htmlUrl}) ${issue.title} — \`${issue.repoFullName}\`${labels}${when ? ` · _${when}_` : ""}`,
      );
    }
    if (list.length > 15) {
      lines.push(`_…and ${list.length - 15} more in ${bucket}_`);
    }
    lines.push("");
  }

  let description = lines.join("\n").trim();
  if (description.length > 4000) {
    description = `${description.slice(0, 3990)}…`;
  }

  embed.setDescription(description);
  embed.addFields({
    name: "Total open",
    value: String(issues.length),
    inline: true,
  });

  return embed;
}

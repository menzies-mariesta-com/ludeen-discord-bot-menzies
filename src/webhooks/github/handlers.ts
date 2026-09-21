import { EmbedBuilder } from "discord.js";

const COLOR_PR = 0x8957e5;
const COLOR_SUCCESS = 0x238636;
const COLOR_FAILURE = 0xda3633;
const COLOR_CANCELLED = 0x6e7681;
const COLOR_RELEASE = 0xd4a72c;
const COLOR_PUSH = 0x58a6ff;
const COLOR_NEUTRAL = 0x8b949e;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value !== null && typeof value === "object"
    ? (value as Json)
    : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function buildGitHubEmbed(
  event: string,
  payload: Json,
): EmbedBuilder | null {
  switch (event) {
    case "ping":
      return null;
    case "pull_request":
      return embedPullRequest(payload);
    case "pull_request_review":
      return embedPullRequestReview(payload);
    case "workflow_run":
      return embedWorkflowRun(payload);
    case "check_suite":
      return embedCheckSuite(payload);
    case "release":
      return embedRelease(payload);
    case "push":
      return embedPush(payload);
    default:
      return null;
  }
}

function embedPullRequest(payload: Json): EmbedBuilder | null {
  const action = str(payload.action);
  const allowed = new Set([
    "opened",
    "closed",
    "reopened",
    "ready_for_review",
    "converted_to_draft",
    "review_requested",
  ]);
  if (!allowed.has(action)) return null;

  const pr = asRecord(payload.pull_request);
  if (!pr) return null;

  const merged = Boolean(pr.merged);
  const title = str(pr.title, "Pull request");
  const number = typeof pr.number === "number" ? pr.number : 0;
  const url = str(pr.html_url);
  const user = asRecord(pr.user);
  const author = str(user?.login, "unknown");
  const repo = asRecord(payload.repository);
  const repoName = str(repo?.full_name, "unknown");

  let headline = action.replaceAll("_", " ");
  if (action === "closed" && merged) headline = "merged";

  const color =
    headline === "merged"
      ? COLOR_SUCCESS
      : action === "closed"
        ? COLOR_FAILURE
        : COLOR_PR;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`PR #${number} ${headline}`)
    .setURL(url || null)
    .setDescription(truncate(title, 200))
    .addFields(
      { name: "Repo", value: repoName, inline: true },
      { name: "Author", value: author, inline: true },
    )
    .setTimestamp(new Date());

  if (action === "review_requested") {
    const requested = asRecord(payload.requested_reviewer);
    const team = asRecord(payload.requested_team);
    const who =
      str(requested?.login) ||
      str(team?.slug) ||
      "someone";
    embed.addFields({ name: "Reviewer", value: who, inline: true });
  }

  return embed;
}

function embedPullRequestReview(payload: Json): EmbedBuilder | null {
  if (str(payload.action) !== "submitted") return null;

  const review = asRecord(payload.review);
  const pr = asRecord(payload.pull_request);
  if (!review || !pr) return null;

  const state = str(review.state, "commented").toLowerCase();
  const reviewer = str(asRecord(review.user)?.login, "unknown");
  const number = typeof pr.number === "number" ? pr.number : 0;
  const url = str(review.html_url) || str(pr.html_url);
  const repo = asRecord(payload.repository);
  const repoName = str(repo?.full_name, "unknown");

  const color =
    state === "approved"
      ? COLOR_SUCCESS
      : state === "changes_requested"
        ? COLOR_FAILURE
        : COLOR_NEUTRAL;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`PR #${number} review: ${state.replaceAll("_", " ")}`)
    .setURL(url || null)
    .setDescription(truncate(str(pr.title, "Pull request"), 200))
    .addFields(
      { name: "Repo", value: repoName, inline: true },
      { name: "Reviewer", value: reviewer, inline: true },
    )
    .setTimestamp(new Date());
}

function embedWorkflowRun(payload: Json): EmbedBuilder | null {
  if (str(payload.action) !== "completed") return null;

  const run = asRecord(payload.workflow_run);
  if (!run) return null;

  const conclusion = str(run.conclusion, "unknown");
  const name = str(run.name, "Workflow");
  const url = str(run.html_url);
  const branch = str(run.head_branch, "unknown");
  const repo = asRecord(payload.repository);
  const repoName = str(repo?.full_name, "unknown");

  const color =
    conclusion === "success"
      ? COLOR_SUCCESS
      : conclusion === "failure" || conclusion === "timed_out"
        ? COLOR_FAILURE
        : COLOR_CANCELLED;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`CI: ${name} — ${conclusion}`)
    .setURL(url || null)
    .addFields(
      { name: "Repo", value: repoName, inline: true },
      { name: "Branch", value: branch, inline: true },
    )
    .setTimestamp(new Date());
}

function embedCheckSuite(payload: Json): EmbedBuilder | null {
  if (str(payload.action) !== "completed") return null;

  const suite = asRecord(payload.check_suite);
  if (!suite) return null;

  const conclusion = str(suite.conclusion, "unknown");
  const branch = str(suite.head_branch, "unknown");
  const repo = asRecord(payload.repository);
  const repoName = str(repo?.full_name, "unknown");
  const repoUrl = str(repo?.html_url);

  const color =
    conclusion === "success"
      ? COLOR_SUCCESS
      : conclusion === "failure" || conclusion === "timed_out"
        ? COLOR_FAILURE
        : COLOR_CANCELLED;

  const app = asRecord(suite.app);
  const appName = str(app?.name, "Checks");

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`Check suite: ${appName} — ${conclusion}`)
    .setURL(repoUrl || null)
    .addFields(
      { name: "Repo", value: repoName, inline: true },
      { name: "Branch", value: branch, inline: true },
    )
    .setTimestamp(new Date());
}

function embedRelease(payload: Json): EmbedBuilder | null {
  if (str(payload.action) !== "published") return null;

  const release = asRecord(payload.release);
  if (!release) return null;

  const name = str(release.name) || str(release.tag_name, "Release");
  const tag = str(release.tag_name, "");
  const url = str(release.html_url);
  const repo = asRecord(payload.repository);
  const repoName = str(repo?.full_name, "unknown");
  const body = truncate(str(release.body).trim() || "_No release notes_", 400);

  return new EmbedBuilder()
    .setColor(COLOR_RELEASE)
    .setTitle(`Release: ${name}`)
    .setURL(url || null)
    .setDescription(body)
    .addFields(
      { name: "Repo", value: repoName, inline: true },
      ...(tag ? [{ name: "Tag", value: tag, inline: true }] : []),
    )
    .setTimestamp(new Date());
}

function embedPush(payload: Json): EmbedBuilder | null {
  const repo = asRecord(payload.repository);
  if (!repo) return null;

  // Skip tag pushes
  const ref = str(payload.ref);
  if (ref.startsWith("refs/tags/")) return null;

  const defaultBranch = str(repo.default_branch, "main");
  const branch = ref.replace(/^refs\/heads\//, "");
  if (branch !== defaultBranch) return null;

  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  if (commits.length === 0) return null;

  const repoName = str(repo.full_name, "unknown");
  const compare = str(payload.compare);
  const pusher = str(asRecord(payload.pusher)?.name, "someone");

  const lines = commits
    .slice(0, 5)
    .map((c) => {
      const commit = asRecord(c);
      if (!commit) return null;
      const sha = str(commit.id).slice(0, 7);
      const message = truncate(str(commit.message).split("\n")[0] ?? "", 72);
      const url = str(commit.url);
      return url ? `[\`${sha}\`](${url}) ${message}` : `\`${sha}\` ${message}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return null;

  const more =
    commits.length > 5 ? `\n_…and ${commits.length - 5} more_` : "";

  return new EmbedBuilder()
    .setColor(COLOR_PUSH)
    .setTitle(`Push to ${branch}`)
    .setURL(compare || null)
    .setDescription(`${lines.join("\n")}${more}`)
    .addFields(
      { name: "Repo", value: repoName, inline: true },
      { name: "Pusher", value: pusher, inline: true },
    )
    .setTimestamp(new Date());
}

import { config } from "../config";
import { parseRepoRef, type GitHubRepoRef } from "./client";

export class UnmappedChannelError extends Error {
  constructor(public readonly channelId: string) {
    super(
      `No GitHub repo is mapped for this channel (\`${channelId}\`). Ask an admin to add it to \`GITHUB_REPO_MAP\`.`,
    );
    this.name = "UnmappedChannelError";
  }
}

/** Resolve the GitHub repo targeted by a Discord channel. */
export function resolveRepoForChannel(channelId: string): GitHubRepoRef {
  const fullName = config.githubRepoMap[channelId];
  if (!fullName) {
    throw new UnmappedChannelError(channelId);
  }
  return parseRepoRef(fullName);
}

export function listMappedRepos(): Array<{ channelId: string; fullName: string }> {
  return Object.entries(config.githubRepoMap).map(([channelId, fullName]) => ({
    channelId,
    fullName,
  }));
}

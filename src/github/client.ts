import { Octokit } from "@octokit/rest";
import { config } from "../config";

export const octokit = new Octokit({
  auth: config.GITHUB_TOKEN,
  userAgent: "ludeen-discord-bot-menzies",
});

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  fullName: string;
}

export function parseRepoRef(fullName: string): GitHubRepoRef {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo ref: ${fullName}`);
  }
  return { owner, repo, fullName };
}

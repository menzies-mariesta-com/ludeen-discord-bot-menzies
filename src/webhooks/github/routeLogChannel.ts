import {
  ChannelType,
  type Client,
  type GuildTextBasedChannel,
} from "discord.js";
import { config } from "../../config";

const LOG_PREFIX = "log";

/** Find the Discord channel ID mapped to a GitHub repo (first match). */
export function findMappedChannelIdForRepo(fullName: string): string | null {
  const target = fullName.toLowerCase();
  for (const [channelId, repo] of Object.entries(config.githubRepoMap)) {
    if (repo.toLowerCase() === target) return channelId;
  }
  return null;
}

/**
 * Resolve the category `log*` text channel for a GitHub repo via GITHUB_REPO_MAP.
 */
export async function resolveLogChannelForRepo(
  client: Client,
  repoFullName: string,
): Promise<GuildTextBasedChannel | null> {
  const mappedChannelId = findMappedChannelIdForRepo(repoFullName);
  if (!mappedChannelId) {
    console.warn(
      `[webhooks] No GITHUB_REPO_MAP entry for repo ${repoFullName}`,
    );
    return null;
  }

  const mapped = await client.channels.fetch(mappedChannelId).catch(() => null);
  if (!mapped || !mapped.isTextBased() || mapped.isDMBased()) {
    console.warn(
      `[webhooks] Mapped channel ${mappedChannelId} for ${repoFullName} is missing or not a guild text channel`,
    );
    return null;
  }

  if (!("parent" in mapped) || !mapped.parent) {
    console.warn(
      `[webhooks] Mapped channel ${mappedChannelId} has no category — cannot find log channel`,
    );
    return null;
  }

  const category = mapped.parent;
  if (category.type !== ChannelType.GuildCategory) {
    console.warn(
      `[webhooks] Parent of ${mappedChannelId} is not a category`,
    );
    return null;
  }

  const logChannel = category.children.cache.find(
    (child) =>
      child.type === ChannelType.GuildText &&
      child.name.toLowerCase().startsWith(LOG_PREFIX),
  );

  if (!logChannel || logChannel.type !== ChannelType.GuildText) {
    console.warn(
      `[webhooks] No text channel starting with "${LOG_PREFIX}" in category ${category.name} for ${repoFullName}`,
    );
    return null;
  }

  return logChannel;
}

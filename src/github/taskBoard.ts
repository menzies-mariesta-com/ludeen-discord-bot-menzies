import { eq } from "drizzle-orm";
import {
  ChannelType,
  type Client,
  type GuildTextBasedChannel,
  type TextChannel,
} from "discord.js";
import { db } from "../db";
import { userLinks, userTaskBoards } from "../db/schema";
import { getGithubUsername } from "./links";
import { buildTaskBoardEmbed, fetchAssignedIssues } from "./tasks";

function canHostPrivateThreads(
  channel: GuildTextBasedChannel,
): channel is TextChannel {
  return channel.type === ChannelType.GuildText;
}

export async function openOrRefreshTaskBoard(
  client: Client,
  discordUserId: string,
  parentChannel: GuildTextBasedChannel,
): Promise<{ threadId: string; created: boolean; issueCount: number }> {
  const githubUsername = await getGithubUsername(discordUserId);
  if (!githubUsername) {
    throw new Error(
      "Link your GitHub account first with `/link github username:yourname`.",
    );
  }

  if (!canHostPrivateThreads(parentChannel)) {
    throw new Error(
      "Private task threads can only be opened from a normal text channel.",
    );
  }

  const existing = await db
    .select()
    .from(userTaskBoards)
    .where(eq(userTaskBoards.discordUserId, discordUserId))
    .limit(1);

  let threadId: string | undefined = existing[0]?.threadId;
  let messageId: string | null = existing[0]?.messageId ?? null;
  let created = false;

  if (threadId) {
    try {
      const thread = await client.channels.fetch(threadId);
      if (!thread || !thread.isThread()) {
        threadId = undefined;
      } else {
        if (thread.archived) {
          await thread.setArchived(false);
        }
        try {
          await thread.members.add(discordUserId);
        } catch {
          // Already a member or missing permission — continue
        }
      }
    } catch {
      threadId = undefined;
    }
  }

  if (!threadId) {
    const thread = await parentChannel.threads.create({
      name: `tasks-${githubUsername}`.slice(0, 100),
      type: ChannelType.PrivateThread,
      invitable: false,
      reason: `Task board for Discord user ${discordUserId}`,
    });

    await thread.members.add(discordUserId);
    threadId = thread.id;
    messageId = null;
    created = true;
  }

  const issues = await fetchAssignedIssues(githubUsername);
  const embed = buildTaskBoardEmbed(githubUsername, issues);
  const thread = await client.channels.fetch(threadId);

  if (!thread || !thread.isThread()) {
    throw new Error(
      "Could not access your task thread. Try `/tasks open` again.",
    );
  }

  if (messageId) {
    try {
      const message = await thread.messages.fetch(messageId);
      await message.edit({ embeds: [embed] });
    } catch {
      const message = await thread.send({ embeds: [embed] });
      messageId = message.id;
    }
  } else {
    const message = await thread.send({ embeds: [embed] });
    messageId = message.id;
  }

  const parentChannelId = existing[0]?.parentChannelId ?? parentChannel.id;

  await db
    .insert(userTaskBoards)
    .values({
      discordUserId,
      parentChannelId: created ? parentChannel.id : parentChannelId,
      threadId,
      messageId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userTaskBoards.discordUserId,
      set: {
        ...(created
          ? { parentChannelId: parentChannel.id }
          : {}),
        threadId,
        messageId,
        updatedAt: new Date(),
      },
    });

  return { threadId, created, issueCount: issues.length };
}

/** Refresh boards for Discord users linked to the given GitHub usernames. */
export async function refreshBoardsForGithubUsers(
  client: Client,
  githubUsernames: string[],
): Promise<void> {
  const unique = [
    ...new Set(githubUsernames.map((u) => u.replace(/^@/, "").toLowerCase())),
  ];

  for (const username of unique) {
    try {
      const links = await db
        .select()
        .from(userLinks)
        .where(eq(userLinks.githubUsername, username));

      for (const link of links) {
        const board = await db
          .select()
          .from(userTaskBoards)
          .where(eq(userTaskBoards.discordUserId, link.discordUserId))
          .limit(1);

        if (!board[0]) continue;

        try {
          const parent = await client.channels.fetch(board[0].parentChannelId);
          if (!parent || !parent.isTextBased() || parent.isDMBased()) continue;
          await openOrRefreshTaskBoard(
            client,
            link.discordUserId,
            parent as GuildTextBasedChannel,
          );
        } catch (error) {
          console.error(
            `[tasks] Failed to refresh board for ${link.discordUserId}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error(
        `[tasks] Failed to refresh boards for @${username}:`,
        error,
      );
    }
  }
}

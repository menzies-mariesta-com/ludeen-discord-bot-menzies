import { eq } from "drizzle-orm";
import { db } from "../db";
import { userLinks } from "../db/schema";

export async function getGithubUsername(
  discordUserId: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(userLinks)
    .where(eq(userLinks.discordUserId, discordUserId))
    .limit(1);

  return rows[0]?.githubUsername ?? null;
}

export async function getDiscordUserIdByGithub(
  githubUsername: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(userLinks)
    .where(eq(userLinks.githubUsername, githubUsername.toLowerCase()))
    .limit(1);

  return rows[0]?.discordUserId ?? null;
}

export async function linkGithubAccount(
  discordUserId: string,
  githubUsername: string,
): Promise<void> {
  const normalized = githubUsername.replace(/^@/, "").toLowerCase();
  const now = new Date();

  await db
    .insert(userLinks)
    .values({
      discordUserId,
      githubUsername: normalized,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userLinks.discordUserId,
      set: {
        githubUsername: normalized,
        updatedAt: now,
      },
    });
}

export async function unlinkGithubAccount(
  discordUserId: string,
): Promise<boolean> {
  const result = await db
    .delete(userLinks)
    .where(eq(userLinks.discordUserId, discordUserId))
    .returning({ id: userLinks.discordUserId });

  return result.length > 0;
}

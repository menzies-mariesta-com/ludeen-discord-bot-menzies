import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const guildSettings = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  prefix: text("prefix").default("!").notNull(),
  welcomeChannelId: text("welcome_channel_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Discord user ↔ GitHub username link */
export const userLinks = pgTable("user_links", {
  discordUserId: text("discord_user_id").primaryKey(),
  githubUsername: text("github_username").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Private task-board thread per Discord user */
export const userTaskBoards = pgTable("user_task_boards", {
  discordUserId: text("discord_user_id").primaryKey(),
  parentChannelId: text("parent_channel_id").notNull(),
  threadId: text("thread_id").notNull(),
  messageId: text("message_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

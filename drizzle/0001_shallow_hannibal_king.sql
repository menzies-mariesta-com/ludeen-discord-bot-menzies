CREATE TABLE "user_links" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"github_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_task_boards" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"parent_channel_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

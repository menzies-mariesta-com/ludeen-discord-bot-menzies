import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const repoRefSchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, 'Repo must be "owner/name"');

const githubRepoMapSchema = z.string().default("{}").superRefine((raw, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "GITHUB_REPO_MAP must be valid JSON",
    });
    return;
  }

  const result = z.record(z.string(), repoRefSchema).safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: "custom",
        message: `GITHUB_REPO_MAP ${issue.path.join(".")}: ${issue.message}`,
      });
    }
  }
}).transform((raw) => {
  const parsed = JSON.parse(raw) as Record<string, string>;
  return z.record(z.string(), repoRefSchema).parse(parsed);
});

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  GITHUB_REPO_MAP: githubRepoMapSchema,
  GITHUB_WEBHOOK_SECRET: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),
  WEBHOOK_PORT: z.string().optional(),
  PORT: z.string().optional(),
  /** Max Discord upload size per meeting file part, in megabytes (default 24). */
  MEETING_MAX_UPLOAD_MB: z.string().optional(),
  /**
   * Comma-separated HTTP(S) audio stream URLs for /lofi.
   * Rotates on stream end; avoids immediate repeat when 2+ URLs are set.
   */
  LOFI_STREAM_URLS: z.string().min(1, "LOFI_STREAM_URLS is required"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const webhookPort = Number(
  parsed.data.PORT ?? parsed.data.WEBHOOK_PORT ?? "8080",
);

if (!Number.isFinite(webhookPort) || webhookPort <= 0) {
  console.error("Invalid environment variables:");
  console.error("  - PORT/WEBHOOK_PORT: must be a positive number");
  process.exit(1);
}

const meetingMaxUploadMb = Number(parsed.data.MEETING_MAX_UPLOAD_MB ?? "24");
if (
  !Number.isFinite(meetingMaxUploadMb) ||
  meetingMaxUploadMb <= 0 ||
  meetingMaxUploadMb > 100
) {
  console.error("Invalid environment variables:");
  console.error(
    "  - MEETING_MAX_UPLOAD_MB: must be a number between 0 (exclusive) and 100",
  );
  process.exit(1);
}

const lofiStreamUrls = parsed.data.LOFI_STREAM_URLS.split(",")
  .map((u) => u.trim())
  .filter(Boolean);

if (lofiStreamUrls.length === 0) {
  console.error("Invalid environment variables:");
  console.error("  - LOFI_STREAM_URLS: provide at least one HTTP(S) stream URL");
  process.exit(1);
}

for (const url of lofiStreamUrls) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("protocol");
    }
  } catch {
    console.error("Invalid environment variables:");
    console.error(`  - LOFI_STREAM_URLS: invalid URL "${url}"`);
    process.exit(1);
  }
}

export const config = {
  DISCORD_TOKEN: parsed.data.DISCORD_TOKEN,
  DISCORD_CLIENT_ID: parsed.data.DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID: parsed.data.DISCORD_GUILD_ID,
  DATABASE_URL: parsed.data.DATABASE_URL,
  GITHUB_TOKEN: parsed.data.GITHUB_TOKEN,
  githubRepoMap: parsed.data.GITHUB_REPO_MAP,
  GITHUB_WEBHOOK_SECRET: parsed.data.GITHUB_WEBHOOK_SECRET,
  webhookPort,
  meetingMaxUploadBytes: Math.floor(meetingMaxUploadMb * 1024 * 1024),
  lofiStreamUrls,
};

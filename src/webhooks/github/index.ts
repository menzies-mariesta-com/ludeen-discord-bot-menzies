import type { Client } from "discord.js";
import { buildGitHubEmbed } from "./handlers";
import { resolveLogChannelForRepo } from "./routeLogChannel";
import { verifyGitHubSignature } from "./verify";

type Json = Record<string, unknown>;

export interface GitHubWebhookResult {
  status: number;
  body: string;
}

/**
 * Handle a raw GitHub webhook delivery: verify, route, post embed.
 */
export async function handleGitHubWebhook(options: {
  client: Client;
  rawBody: Buffer;
  signature: string | undefined;
  event: string | undefined;
}): Promise<GitHubWebhookResult> {
  const { client, rawBody, signature, event } = options;

  if (!verifyGitHubSignature(rawBody, signature)) {
    return { status: 401, body: "invalid signature" };
  }

  if (!event) {
    return { status: 400, body: "missing event" };
  }

  if (event === "ping") {
    return { status: 200, body: "pong" };
  }

  let payload: Json;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Json;
  } catch {
    return { status: 400, body: "invalid json" };
  }

  const repo = payload.repository;
  const fullName =
    repo !== null &&
    typeof repo === "object" &&
    typeof (repo as Json).full_name === "string"
      ? ((repo as Json).full_name as string)
      : null;

  if (!fullName) {
    console.warn(`[webhooks] ${event}: payload missing repository.full_name`);
    return { status: 200, body: "ignored" };
  }

  const embed = buildGitHubEmbed(event, payload);
  if (!embed) {
    return { status: 200, body: "ignored" };
  }

  const logChannel = await resolveLogChannelForRepo(client, fullName);
  if (!logChannel) {
    return { status: 200, body: "unmapped" };
  }

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error(
      `[webhooks] Failed to post ${event} for ${fullName} to #${logChannel.name}:`,
      error,
    );
    return { status: 500, body: "send failed" };
  }

  return { status: 200, body: "ok" };
}

import { generateDependencyReport } from "@discordjs/voice";
import { config } from "./config";
import { BotClient } from "./client";
import { loadCommands } from "./handlers/commandHandler";
import { loadEvents } from "./handlers/eventHandler";
import { runMigrations } from "./db/migrate";
import { startWebhookServer } from "./webhooks/server";

process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[process] Uncaught exception:", error);
  process.exit(1);
});

async function waitUntilReady(client: BotClient): Promise<void> {
  if (client.isReady()) return;

  await new Promise<void>((resolve) => {
    client.once("clientReady", () => resolve());
  });
}

async function initVoiceCrypto(): Promise<void> {
  // libsodium-wrappers must finish loading before voice encryption runs
  const sodium = await import("libsodium-wrappers");
  await sodium.default.ready;
  console.log("[voice] Encryption ready");
  console.log(generateDependencyReport());
}

async function main() {
  await runMigrations();
  await initVoiceCrypto();

  const client = new BotClient();

  await loadCommands(client);
  await loadEvents(client);
  await client.login(config.DISCORD_TOKEN);
  await waitUntilReady(client);

  startWebhookServer(client);
}

main().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});

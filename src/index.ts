import { config } from "./config";
import { BotClient } from "./client";
import { loadCommands } from "./handlers/commandHandler";
import { loadEvents } from "./handlers/eventHandler";
import { db } from "./db";
import { startWebhookServer } from "./webhooks/server";

async function waitUntilReady(client: BotClient): Promise<void> {
  if (client.isReady()) return;

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    client.once("clientReady", done);
    client.once("ready", done);
  });
}

async function main() {
  // Touch the DB client so connection config is validated at boot.
  void db;

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

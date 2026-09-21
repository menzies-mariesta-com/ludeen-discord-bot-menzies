import fs from "node:fs";
import path from "node:path";
import type { ClientEvents } from "discord.js";
import type { BotClient } from "../client";

interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute: (...args: ClientEvents[K]) => void | Promise<void>;
}

export async function loadEvents(client: BotClient): Promise<void> {
  const eventsPath = path.join(__dirname, "..", "events");
  const eventFiles = fs
    .readdirSync(eventsPath)
    .filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const imported = await import(filePath);
    const event = (imported.default ?? imported) as BotEvent;

    if (!event?.name || typeof event.execute !== "function") {
      console.warn(`[events] Skipping invalid event file: ${filePath}`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => void event.execute(...args));
    } else {
      client.on(event.name, (...args) => void event.execute(...args));
    }

    console.log(`[events] Loaded ${event.name}${event.once ? " (once)" : ""}`);
  }
}

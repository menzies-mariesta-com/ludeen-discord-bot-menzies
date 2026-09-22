import fs from "node:fs";
import path from "node:path";
import type { ClientEvents } from "discord.js";
import type { BotClient } from "../client";
import { isRuntimeModuleFile } from "../utils/runtimeFiles";

interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute: (...args: ClientEvents[K]) => void | Promise<void>;
}

export async function loadEvents(client: BotClient): Promise<void> {
  const eventsPath = path.join(__dirname, "..", "events");
  const eventFiles = fs.readdirSync(eventsPath).filter(isRuntimeModuleFile);

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const imported = await import(filePath);
    const event = (imported.default ?? imported) as BotEvent;

    if (!event?.name || typeof event.execute !== "function") {
      console.warn(`[events] Skipping invalid event file: ${filePath}`);
      continue;
    }

    const run = (...args: Parameters<typeof event.execute>) => {
      void Promise.resolve(event.execute(...args)).catch((error) => {
        console.error(`[events] Error in ${String(event.name)}:`, error);
      });
    };

    if (event.once) {
      client.once(event.name, run);
    } else {
      client.on(event.name, run);
    }

    console.log(`[events] Loaded ${event.name}${event.once ? " (once)" : ""}`);
  }
}

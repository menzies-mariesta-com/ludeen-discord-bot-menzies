import fs from "node:fs";
import path from "node:path";
import type { BotClient } from "../client";
import type { SlashCommand } from "../types/command";

export async function loadCommands(client: BotClient): Promise<void> {
  const commandsPath = path.join(__dirname, "..", "commands");
  const categories = fs
    .readdirSync(commandsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category.name);
    const commandFiles = fs
      .readdirSync(categoryPath)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

    for (const file of commandFiles) {
      const filePath = path.join(categoryPath, file);
      const imported = await import(filePath);
      const command = (imported.default ?? imported) as SlashCommand;

      if (!command?.data?.name || typeof command.execute !== "function") {
        console.warn(`[commands] Skipping invalid command file: ${filePath}`);
        continue;
      }

      client.commands.set(command.data.name, command);
      console.log(`[commands] Loaded /${command.data.name}`);
    }
  }
}

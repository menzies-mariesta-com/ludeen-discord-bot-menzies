import fs from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { config } from "./config";
import type { SlashCommand } from "./types/command";
import { isRuntimeModuleFile } from "./utils/runtimeFiles";

async function loadCommandData() {
  const commands = [];
  const commandsPath = path.join(__dirname, "commands");
  const categories = fs
    .readdirSync(commandsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category.name);
    const commandFiles = fs
      .readdirSync(categoryPath)
      .filter(isRuntimeModuleFile);

    for (const file of commandFiles) {
      const filePath = path.join(categoryPath, file);
      const imported = await import(filePath);
      const command = (imported.default ?? imported) as SlashCommand;

      if (!command?.data?.name) {
        console.warn(`[deploy] Skipping invalid command file: ${filePath}`);
        continue;
      }

      commands.push(command.data.toJSON());
    }
  }

  return commands;
}

async function main() {
  const commands = await loadCommandData();
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

  console.log(
    `Deploying ${commands.length} guild command(s) to ${config.DISCORD_GUILD_ID}...`,
  );

  const data = (await rest.put(
    Routes.applicationGuildCommands(
      config.DISCORD_CLIENT_ID,
      config.DISCORD_GUILD_ID,
    ),
    { body: commands },
  )) as unknown[];

  console.log(`Successfully deployed ${data.length} command(s).`);
}

main().catch((error) => {
  console.error("Failed to deploy commands:", error);
  process.exit(1);
});

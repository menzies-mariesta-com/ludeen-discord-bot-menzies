import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { SlashCommand } from "./types/command";

export class BotClient extends Client {
  commands = new Collection<string, SlashCommand>();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });
  }
}

declare module "discord.js" {
  interface Client {
    commands: Collection<string, SlashCommand>;
  }
}

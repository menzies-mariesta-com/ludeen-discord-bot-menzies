import { Events } from "discord.js";
import type { BotClient } from "../client";

export default {
  name: Events.ClientReady,
  once: true,
  execute(client: BotClient) {
    console.log(`Ready! Logged in as ${client.user?.tag}`);
    console.log(`Serving ${client.guilds.cache.size} guild(s)`);
  },
};

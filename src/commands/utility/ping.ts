import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "../../types/command";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),
  async execute(interaction) {
    const sent = await interaction.reply({
      content: "Pinging...",
      fetchReply: true,
    });

    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const websocket = interaction.client.ws.ping;

    await interaction.editReply(
      `Pong! Roundtrip: \`${roundtrip}ms\` | Websocket: \`${websocket}ms\``,
    );
  },
};

export default command;

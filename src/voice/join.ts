import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type JoinVoiceChannelOptions,
  type CreateVoiceConnectionOptions,
  type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";

type JoinOptions = Omit<
  JoinVoiceChannelOptions & CreateVoiceConnectionOptions,
  "channelId" | "guildId" | "adapterCreator"
>;

/**
 * Join a voice channel and wait until Ready, with clearer failure details.
 */
export async function joinVoiceChannelReady(
  voiceChannel: VoiceBasedChannel,
  options: JoinOptions,
  timeoutMs = 30_000,
): Promise<VoiceConnection> {
  const existing = getVoiceConnection(voiceChannel.guild.id);
  if (existing) {
    existing.destroy();
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    ...options,
  });

  const path: string[] = [connection.state.status];

  const onChange = (oldState: { status: string }, next: { status: string }) => {
    const reason =
      "reason" in next && typeof (next as { reason?: string }).reason === "string"
        ? (next as { reason: string }).reason
        : undefined;
    const closeCode =
      "closeCode" in next &&
      typeof (next as { closeCode?: number }).closeCode === "number"
        ? (next as { closeCode: number }).closeCode
        : undefined;

    const detail = [
      next.status,
      reason ? `reason=${reason}` : null,
      closeCode != null ? `code=${closeCode}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    path.push(detail);
    console.log(`[voice] ${voiceChannel.id}: ${oldState.status} → ${detail}`);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection.on("stateChange" as any, onChange);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, timeoutMs);
    return connection;
  } catch {
    const last = connection.state.status;
    try {
      connection.destroy();
    } catch {
      // ignore
    }
    throw new Error(
      `Failed to join voice (last=${last}, path=${path.join(" → ")}). ` +
        `Confirm the bot has **Connect** (+ **Speak** for lofi) in that channel, ` +
        `and that the host allows outbound UDP (required for Discord voice).`,
    );
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection.off("stateChange" as any, onChange);
  }
}

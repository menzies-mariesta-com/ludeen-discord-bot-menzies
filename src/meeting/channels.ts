import {
  ChannelType,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type VoiceBasedChannel,
} from "discord.js";

const MEETING_VOICE_PREFIX = "meeting";
const MEETING_RECORD_PREFIX = "meeting-record";

export function isMeetingVoiceChannel(channel: VoiceBasedChannel): boolean {
  const name = channel.name.toLowerCase();
  return (
    name.startsWith(MEETING_VOICE_PREFIX) &&
    !name.startsWith(MEETING_RECORD_PREFIX)
  );
}

export function isMeetingRecordChannel(channel: GuildBasedChannel): boolean {
  if (channel.type !== ChannelType.GuildText) return false;
  return channel.name.toLowerCase().startsWith(MEETING_RECORD_PREFIX);
}

/**
 * Find the meeting-record text channel in the same category as the voice channel.
 */
export function resolveMeetingRecordChannel(
  voiceChannel: VoiceBasedChannel,
): GuildTextBasedChannel {
  const category = voiceChannel.parent;
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(
      "This meeting voice channel must be inside a category that also has a `meeting-record*` text channel.",
    );
  }

  const record = category.children.cache.find(
    (child) =>
      child.type === ChannelType.GuildText &&
      child.name.toLowerCase().startsWith(MEETING_RECORD_PREFIX),
  );

  if (!record || record.type !== ChannelType.GuildText) {
    throw new Error(
      `No text channel starting with \`${MEETING_RECORD_PREFIX}\` found in category **${category.name}**.`,
    );
  }

  return record;
}

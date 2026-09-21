import {
  PermissionFlagsBits,
  type GuildMember,
  type VoiceBasedChannel,
} from "discord.js";

const MEETING_RECORDER_ROLE = "meeting recorder";

export function canControlRecording(
  member: GuildMember,
  starterId: string,
): boolean {
  if (member.id === starterId) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;

  return member.roles.cache.some(
    (role) => role.name.toLowerCase() === MEETING_RECORDER_ROLE,
  );
}

export function memberInVoiceChannel(
  member: GuildMember,
  voiceChannel: VoiceBasedChannel,
): boolean {
  return member.voice.channelId === voiceChannel.id;
}

export function countHumansInVoice(voiceChannel: VoiceBasedChannel): number {
  return voiceChannel.members.filter((m) => !m.user.bot).size;
}

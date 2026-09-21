import { Events, type VoiceState } from "discord.js";
import { handleVoiceStateForSessions } from "../meeting/sessionManager";
import { handleVoiceStateForLofi } from "../lofi/sessionManager";

export default {
  name: Events.VoiceStateUpdate,
  execute(oldState: VoiceState, newState: VoiceState) {
    const client = oldState.client;

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    if (oldChannel) {
      handleVoiceStateForSessions(client, oldChannel);
      handleVoiceStateForLofi(client, oldChannel);
    }
    if (newChannel && newChannel.id !== oldChannel?.id) {
      handleVoiceStateForSessions(client, newChannel);
      handleVoiceStateForLofi(client, newChannel);
    }
  },
};

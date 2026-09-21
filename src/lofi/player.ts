import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  type AudioPlayer,
} from "@discordjs/voice";
import { config } from "../config";

export function createLofiPlayer(): AudioPlayer {
  return createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
    },
  });
}

export function playStreamUrl(player: AudioPlayer, url: string): void {
  const resource = createAudioResource(url, {
    inputType: StreamType.Arbitrary,
    inlineVolume: false,
  });
  player.play(resource);
}

/**
 * Pick the next stream URL, avoiding immediate repeat when multiple URLs exist.
 */
export function nextStreamIndex(
  currentIndex: number,
  urlCount = config.lofiStreamUrls.length,
): number {
  if (urlCount <= 1) return 0;
  return (currentIndex + 1) % urlCount;
}

export function streamLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch {
    return url;
  }
}

export { AudioPlayerStatus };

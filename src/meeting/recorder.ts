import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // s16le
const FRAME_DURATION_MS = 20;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960
export const BYTES_PER_FRAME = FRAME_SAMPLES * CHANNELS * BYTES_PER_SAMPLE;

/**
 * Mixes per-user PCM chunks into a continuous s16le stereo stream.
 * While paused, frames are discarded (timeline does not advance).
 */
export class PcmMixer extends EventEmitter {
  readonly pcmPath: string;
  private readonly writeStream: fs.WriteStream;
  private readonly queues = new Map<string, Buffer>();
  private readonly interval: NodeJS.Timeout;
  private paused = false;
  private closed = false;
  private framesWritten = 0;

  constructor(pcmPath: string) {
    super();
    this.pcmPath = pcmPath;
    fs.mkdirSync(path.dirname(pcmPath), { recursive: true });
    this.writeStream = fs.createWriteStream(pcmPath);

    this.interval = setInterval(() => this.tick(), FRAME_DURATION_MS);
    this.interval.unref?.();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get durationMs(): number {
    return this.framesWritten * FRAME_DURATION_MS;
  }

  pause(): void {
    this.paused = true;
    this.queues.clear();
  }

  resume(): void {
    this.paused = false;
  }

  /** Push decoded PCM (any length); buffered into 20ms frames per user. */
  push(userId: string, pcmChunk: Buffer): void {
    if (this.closed || this.paused || pcmChunk.length === 0) return;

    const existing = this.queues.get(userId) ?? Buffer.alloc(0);
    this.queues.set(userId, Buffer.concat([existing, pcmChunk]));
  }

  private tick(): void {
    if (this.closed || this.paused) return;

    const frames: Buffer[] = [];

    for (const [userId, buffer] of this.queues) {
      if (buffer.length >= BYTES_PER_FRAME) {
        frames.push(buffer.subarray(0, BYTES_PER_FRAME));
        const rest = buffer.subarray(BYTES_PER_FRAME);
        if (rest.length > 0) this.queues.set(userId, rest);
        else this.queues.delete(userId);
      }
    }

    const mixed =
      frames.length === 0 ? Buffer.alloc(BYTES_PER_FRAME) : mixInt16Frames(frames);

    this.writeStream.write(mixed);
    this.framesWritten += 1;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.interval);
    this.queues.clear();

    await new Promise<void>((resolve, reject) => {
      this.writeStream.end(() => resolve());
      this.writeStream.on("error", reject);
    });
  }
}

function mixInt16Frames(frames: Buffer[]): Buffer {
  const out = Buffer.alloc(BYTES_PER_FRAME);
  const sampleCount = BYTES_PER_FRAME / BYTES_PER_SAMPLE;

  for (let i = 0; i < sampleCount; i++) {
    let sum = 0;
    for (const frame of frames) {
      sum += frame.readInt16LE(i * BYTES_PER_SAMPLE);
    }
    // Soft clip
    const mixed = Math.max(-32768, Math.min(32767, sum));
    out.writeInt16LE(mixed, i * BYTES_PER_SAMPLE);
  }

  return out;
}

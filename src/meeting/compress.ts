import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const PCM_BYTES_PER_SEC = 48_000 * 2 * 2; // s16le stereo 48kHz

export interface CompressPart {
  outputPath: string;
  index: number;
  total: number;
}

export interface CompressResult {
  parts: CompressPart[];
  bitrateKbps: number;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      reject(
        new Error(
          `ffmpeg failed to start (${error.message}). Install ffmpeg or ensure it is on PATH.`,
        ),
      );
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`),
        );
    });
  });
}

async function encodePcmSegment(options: {
  pcmPath: string;
  outputPath: string;
  bitrateKbps: number;
  startSec?: number;
  durationSec?: number;
}): Promise<void> {
  const args = [
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    options.pcmPath,
  ];

  if (options.startSec !== undefined && options.startSec > 0) {
    args.push("-ss", options.startSec.toFixed(3));
  }
  if (options.durationSec !== undefined && options.durationSec > 0) {
    args.push("-t", options.durationSec.toFixed(3));
  }

  args.push(
    "-c:a",
    "libopus",
    "-b:a",
    `${options.bitrateKbps}k`,
    "-ac",
    "1",
    "-application",
    "voip",
    "-vbr",
    "on",
    "-compression_level",
    "10",
    options.outputPath,
  );

  await runFfmpeg(args);
}

/**
 * Compress raw s16le stereo 48kHz PCM to Ogg Opus.
 * If still over MEETING_MAX_UPLOAD_MB, split into sequential parts under that limit.
 */
export async function compressMeetingPcm(
  pcmPath: string,
  outputDir: string,
  baseName: string,
): Promise<CompressResult> {
  const maxBytes = config.meetingMaxUploadBytes;
  const bitrates = [32, 24, 16];

  let chosenBitrate = bitrates[bitrates.length - 1]!;
  let fullPath: string | null = null;
  let fullSize = 0;

  for (const bitrateKbps of bitrates) {
    const outputPath = path.join(
      outputDir,
      `${baseName}-${bitrateKbps}k.ogg`,
    );

    await encodePcmSegment({
      pcmPath,
      outputPath,
      bitrateKbps,
    });

    const { size } = await fs.promises.stat(outputPath);
    if (size <= maxBytes) {
      if (fullPath && fullPath !== outputPath) {
        await fs.promises.unlink(fullPath).catch(() => undefined);
      }
      return {
        parts: [{ outputPath, index: 1, total: 1 }],
        bitrateKbps,
      };
    }

    if (fullPath) {
      await fs.promises.unlink(fullPath).catch(() => undefined);
    }
    fullPath = outputPath;
    fullSize = size;
    chosenBitrate = bitrateKbps;
  }

  // Still too large at lowest bitrate — split PCM by time so each part fits.
  const pcmStat = await fs.promises.stat(pcmPath);
  const durationSec = Math.max(pcmStat.size / PCM_BYTES_PER_SEC, 1);
  const bytesPerSec = fullSize / durationSec;
  let segmentSec = Math.max(
    15,
    Math.floor((maxBytes * 0.9) / Math.max(bytesPerSec, 1)),
  );

  if (fullPath) {
    await fs.promises.unlink(fullPath).catch(() => undefined);
  }

  const roughParts: string[] = [];
  let start = 0;
  let partIndex = 0;

  while (start < durationSec - 0.05) {
    partIndex += 1;
    const remaining = durationSec - start;
    let slice = Math.min(segmentSec, remaining);
    let outputPath = path.join(
      outputDir,
      `${baseName}-part${String(partIndex).padStart(2, "0")}.ogg`,
    );

    await encodePcmSegment({
      pcmPath,
      outputPath,
      bitrateKbps: chosenBitrate,
      startSec: start,
      durationSec: slice,
    });

    let { size } = await fs.promises.stat(outputPath);

    // If a slice is still oversized, shrink and re-encode until it fits.
    let guard = 0;
    while (size > maxBytes && slice > 5 && guard < 8) {
      guard += 1;
      slice = Math.max(5, Math.floor(slice * (maxBytes / size) * 0.9));
      await fs.promises.unlink(outputPath).catch(() => undefined);
      await encodePcmSegment({
        pcmPath,
        outputPath,
        bitrateKbps: chosenBitrate,
        startSec: start,
        durationSec: slice,
      });
      size = (await fs.promises.stat(outputPath)).size;
    }

    if (size > maxBytes) {
      throw new Error(
        `Could not split meeting audio under MEETING_MAX_UPLOAD_MB (${Math.round(maxBytes / (1024 * 1024))} MB). Lower the bitrate limit or raise the max.`,
      );
    }

    roughParts.push(outputPath);
    start += slice;
    // Adapt segment length from actual encoded density
    if (size > 0 && slice > 0) {
      const actualBps = size / slice;
      segmentSec = Math.max(
        15,
        Math.floor((maxBytes * 0.9) / Math.max(actualBps, 1)),
      );
    }
  }

  const total = roughParts.length;
  const parts: CompressPart[] = roughParts.map((outputPath, i) => ({
    outputPath,
    index: i + 1,
    total,
  }));

  return { parts, bitrateKbps: chosenBitrate };
}

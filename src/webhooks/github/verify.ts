import crypto from "node:crypto";
import { config } from "../../config";

/**
 * Verify GitHub webhook HMAC SHA-256 signature (X-Hub-Signature-256).
 */
export function verifyGitHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = signatureHeader.slice("sha256=".length);
  const digest = crypto
    .createHmac("sha256", config.GITHUB_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(digest, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

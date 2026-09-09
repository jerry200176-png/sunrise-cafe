import { createHash } from "node:crypto";

/**
 * Derive a UUID-shaped retry key from one logical notification event.
 *
 * LINE keeps retry keys for a bounded provider window. Durable application
 * ledgers remain the long-term dedupe mechanism; this key closes the smaller
 * crash/concurrent-request gap for one-shot group and waitlist pushes.
 */
export function stableLineRetryKey(scope: string, ...parts: string[]): string {
  const digest = createHash("sha256")
    .update([scope, ...parts].join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

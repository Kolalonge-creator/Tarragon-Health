import { createHash } from "node:crypto";

/**
 * A stable UUID (RFC 4122 shape) derived from a seed: the same seed always gives the same id. Used to give a second reading made from one queued entry its own
 * idempotency key (the ketone beside a glucose, the pulse beside a blood pressure), so a blind retry of the same entry is a no-op rather than a duplicate.
 */
export function derivedUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Deterministic randomUUID for offline-vitals-queue.ts — the queue's
 * idempotency key. Sequential rather than random so a test can assert on
 * the exact id a given enqueue produced.
 */
let counter = 0;

export function randomUUID(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

export function __reset(): void {
  counter = 0;
}

/** Real SHA digests (node) so the breached-password hashing is exercised for real. */
import { createHash } from "node:crypto";

export const CryptoDigestAlgorithm = { SHA1: "SHA-1", SHA256: "SHA-256" } as const;

export async function digestStringAsync(
  algorithm: (typeof CryptoDigestAlgorithm)[keyof typeof CryptoDigestAlgorithm],
  data: string,
): Promise<string> {
  return createHash(algorithm === "SHA-1" ? "sha1" : "sha256").update(data).digest("hex");
}

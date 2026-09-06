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

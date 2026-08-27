/**
 * Shared failure log for the device-sync paths (HealthKit, Health Connect,
 * BLE, the background task) — see healthkit.ts, health-connect.ts, ble.ts,
 * background-sync.ts.
 *
 * None of those paths have ever run against real hardware (see CLAUDE.md's
 * Device & Wearable Integration section), and every reader in them already
 * treats "no data" as a normal outcome by design — a denied permission or an
 * empty type must not fail the rest of a sync. That's the right behaviour
 * for the patient, but it means a genuine bug (a wrong unit string, a schema
 * the installed library version doesn't actually return, a real network
 * fault) was previously indistinguishable from "nothing to sync" — both
 * produced the same silent empty result. This module gives first-real-device
 * testing something to look at: every reader that fails records why here
 * instead of just returning [].
 *
 * Deliberately not a crash-reporting SDK (no Sentry/Bugsnag dependency to
 * add) — an in-memory ring buffer plus dev-console output is enough to make
 * a failure visible while a developer is holding the device, which is the
 * actual next step this codebase is waiting on.
 */

export type SyncSource =
  | "apple_health"
  | "android_health_connect"
  | "ble"
  | "background_sync"
  | "yucheng_band";

export interface SyncDiagnosticEntry {
  source: SyncSource;
  /** What was being attempted, e.g. "blood_pressure" or "connectToDevice". */
  detail: string;
  message: string;
  at: string;
}

const RING_BUFFER_SIZE = 50;
const entries: SyncDiagnosticEntry[] = [];

export function recordSyncError(source: SyncSource, detail: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const entry: SyncDiagnosticEntry = { source, detail, message, at: new Date().toISOString() };
  entries.push(entry);
  if (entries.length > RING_BUFFER_SIZE) entries.shift();
  if (__DEV__) {
    console.warn(`[sync:${source}] ${detail} failed: ${message}`);
  }
}

export function getRecentSyncDiagnostics(): SyncDiagnosticEntry[] {
  return [...entries];
}

/**
 * Counts failures recorded at or after `since` (an ISO timestamp captured
 * before a sync attempt started) — how a caller tells "this specific sync
 * hit N reader errors" apart from the ring buffer's whole history.
 */
export function countSyncErrorsSince(source: SyncSource, since: string): number {
  return entries.filter((entry) => entry.source === source && entry.at >= since).length;
}

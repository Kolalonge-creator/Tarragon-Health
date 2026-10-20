import type { Connection } from "./media-policy";
import { readConnectionType } from "./net-connection";
import {
  flushDeviceReadingsQueue,
  flushHealthSamplesQueue,
  flushPhotoReadingsQueue,
  getDeviceReadingsQueueCount,
  getHealthSamplesQueueCount,
  getPhotoReadingsQueueCount,
} from "./offline-queue";
import { isLowDataActive } from "./offline-budget";
import { ensureLowDataLoaded } from "./low-data";
import { loadOfflineReconnectConfig } from "./offline-reconnect-config";
import { flushOutbox, getPendingCount as getOutboxPendingCount } from "./outbox";
import { readPowerState } from "./power-port";
import { workDecision, type DeferReason, type PowerState } from "./power-rules";
import { recordSyncError } from "./sync-diagnostics";

/**
 * Everything waiting on the phone, sent when the connection comes back (S06y). The reachability watcher
 * (reachability.ts) decides WHEN (the radio says it is back and one tiny request proves the server answers);
 * this decides WHAT, and in what order:
 *
 *   1. the S06 outbox (vitals, symptoms, dose logs; urgent rows first inside it)
 *   2. BLE device readings and confirmed photo-read numbers (small, essential)
 *   3. queued health-store sample pages (bulk), unless the phone is low on power, or low-data mode is on and
 *      the connection is not known to be Wi-Fi. Those stay saved on the phone and the sync banner says so.
 *
 * Rules: one run at a time (a second caller gets the run already in flight, never a parallel one); at most one
 * run per offline.reconnect_power.reconnect_flush_min_gap_seconds (a call inside the gap leaves one trailing run, so it is
 * delayed, never lost); a step that fails is recorded and the next
 * step still runs. Nothing here deletes an entry: a failing row stays where it is (the outbox marks a refused
 * row `rejected` and shows it with a support code; a queue keeps an entry until the server takes it).
 */
export interface ReconnectFlushDeps {
  flushOutbox: () => Promise<unknown>;
  flushDeviceReadings: () => Promise<unknown>;
  flushPhotoReadings: () => Promise<unknown>;
  flushHealthSamples: () => Promise<unknown>;
  readPower: () => Promise<PowerState>;
  readConnection: () => Promise<Connection>;
  /** Async because the saved choice must be loaded first: a cold background start has not read it yet. */
  isLowData: () => boolean | Promise<boolean>;
  now: () => number;
  /** Runs `fn` once after `ms`. Used for the one trailing run that a debounced call leaves behind. */
  schedule: (fn: () => void, ms: number) => void;
  minGapMs: number;
  lowBatteryPercent: number;
}

export type BulkOutcome = "sent" | "deferred_low_power" | "deferred_low_data";

export interface ReconnectFlushResult {
  ran: boolean;
  /** Why no run started (only when ran is false). */
  skipped?: "debounced";
  bulk?: BulkOutcome;
  /** Steps that threw. Their entries are still on the phone. */
  failedSteps: string[];
}

export function defaultReconnectFlushDeps(): ReconnectFlushDeps {
  const config = loadOfflineReconnectConfig();
  return {
    flushOutbox,
    flushDeviceReadings: flushDeviceReadingsQueue,
    flushPhotoReadings: flushPhotoReadingsQueue,
    flushHealthSamples: () => flushHealthSamplesQueue(),
    readPower: readPowerState,
    readConnection: readConnectionType,
    isLowData: async () => {
      await ensureLowDataLoaded();
      return isLowDataActive();
    },
    now: () => Date.now(),
    schedule: (fn, ms) => {
      setTimeout(fn, ms);
    },
    minGapMs: config.reconnectFlushMinGapMs,
    lowBatteryPercent: config.lowBatteryPercent,
  };
}

let inFlight: Promise<ReconnectFlushResult> | null = null;
let lastStartedAt: number | null = null;
let trailingScheduled = false;

/** Test seam. */
export function resetReconnectFlushForTests(): void {
  inFlight = null;
  lastStartedAt = null;
  trailingScheduled = false;
}

/**
 * Starts a flush, or does the next best thing. A call while one is running shares it. A call inside the minimum gap
 * does not start a second run, but it is NOT dropped: one trailing run is scheduled for when the gap ends, so an entry
 * saved during the gap still gets a reconnect flush (the watcher counts a good probe as handled and would not retry).
 */
export function reconnectFlush(deps: ReconnectFlushDeps = defaultReconnectFlushDeps()): Promise<ReconnectFlushResult> {
  if (inFlight) return inFlight;
  const now = deps.now();
  if (lastStartedAt !== null && now - lastStartedAt < deps.minGapMs) {
    if (!trailingScheduled) {
      trailingScheduled = true;
      deps.schedule(() => {
        trailingScheduled = false;
        void reconnectFlush(deps).catch(() => undefined);
      }, deps.minGapMs - (now - lastStartedAt));
    }
    return Promise.resolve({ ran: false, skipped: "debounced", failedSteps: [] });
  }
  lastStartedAt = now;
  inFlight = run(deps).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(deps: ReconnectFlushDeps): Promise<ReconnectFlushResult> {
  const failedSteps: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      failedSteps.push(name);
      recordSyncError("offline_outbox", `reconnect:${name}`, error);
    }
  };

  await step("outbox", deps.flushOutbox);
  await step("device_readings", deps.flushDeviceReadings);
  await step("photo_readings", deps.flushPhotoReadings);

  const reason = await currentBulkDeferral(deps);
  if (reason !== null) {
    return { ran: true, bulk: reason === "low_power" ? "deferred_low_power" : "deferred_low_data", failedSteps };
  }
  await step("health_samples", deps.flushHealthSamples);
  return { ran: true, bulk: "sent", failedSteps };
}

/**
 * Whether bulk uploads (queued health-store sample pages) would wait right now, and why. Computed live from the phone's
 * state, not remembered from an earlier run, so it is right in a background task's own JS context and goes away the
 * moment the cause does (plugged in, low-data mode off, back on Wi-Fi). Never throws: if the state cannot be read the
 * answer is "do not wait".
 */
export async function currentBulkDeferral(
  deps: Pick<ReconnectFlushDeps, "readPower" | "readConnection" | "isLowData" | "lowBatteryPercent"> | null = null
): Promise<DeferReason | null> {
  try {
    const d = deps ?? defaultReconnectFlushDeps();
    const [power, connection, lowData] = await Promise.all([d.readPower(), d.readConnection(), d.isLowData()]);
    const decision = workDecision({ work: "upload_bulk", power, lowBatteryPercent: d.lowBatteryPercent, lowData, connection });
    return decision.action === "defer" ? decision.reason : null;
  } catch (error) {
    recordSyncError("offline_outbox", "reconnect:deferralState", error);
    return null;
  }
}

/** Entries waiting anywhere on the phone: the outbox plus the encrypted device, photo and health-sample queues. */
export async function getAllWaitingCount(): Promise<number> {
  const [outbox, devices, photos, healthPages] = await Promise.all([
    getOutboxPendingCount(),
    getDeviceReadingsQueueCount(),
    getPhotoReadingsQueueCount(),
    getHealthSamplesQueueCount(),
  ]);
  // Health pages that are deliberately waiting (low power, low data off Wi-Fi) are not a reason to probe the network again.
  const healthCounted = healthPages > 0 && (await currentBulkDeferral()) === null ? healthPages : 0;
  return outbox + devices + photos + healthCounted;
}

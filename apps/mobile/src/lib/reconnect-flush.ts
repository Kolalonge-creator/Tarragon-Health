import type { Connection } from "./media-policy";
import { readConnectionType } from "./net-connection";
import { flushDeviceReadingsQueue, flushHealthSamplesQueue, flushPhotoReadingsQueue, getPendingCount as getOfflineQueuePendingCount } from "./offline-queue";
import { isLowDataActive } from "./offline-budget";
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
 * run per offline.reconnect_power.reconnect_flush_min_gap_seconds; a step that fails is recorded and the next
 * step still runs. Nothing here deletes an entry: a failing row stays where it is (the outbox marks a refused
 * row `rejected` and shows it with a support code; a queue keeps an entry until the server takes it).
 */
export interface ReconnectFlushDeps {
  /** May answer { stoppedOffline: true } (the outbox does): the run then does not count against the debounce. */
  flushOutbox: () => Promise<unknown>;
  flushDeviceReadings: () => Promise<unknown>;
  flushPhotoReadings: () => Promise<unknown>;
  flushHealthSamples: () => Promise<unknown>;
  readPower: () => Promise<PowerState>;
  readConnection: () => Promise<Connection>;
  isLowData: () => boolean;
  now: () => number;
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
  /** The outbox stopped part-way because the connection or the session was lost. */
  incomplete?: boolean;
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
    isLowData: isLowDataActive,
    now: () => Date.now(),
    minGapMs: config.reconnectFlushMinGapMs,
    lowBatteryPercent: config.lowBatteryPercent,
  };
}

let inFlight: Promise<ReconnectFlushResult> | null = null;
let lastStartedAt: number | null = null;

/** Test seam. */
export function resetReconnectFlushForTests(): void {
  inFlight = null;
  lastStartedAt = null;
}

export function reconnectFlush(deps: ReconnectFlushDeps = defaultReconnectFlushDeps()): Promise<ReconnectFlushResult> {
  if (inFlight) return inFlight;
  const now = deps.now();
  if (lastStartedAt !== null && now - lastStartedAt < deps.minGapMs) {
    return Promise.resolve({ ran: false, skipped: "debounced", failedSteps: [] });
  }
  lastStartedAt = now;
  inFlight = run(deps)
    .then((result) => {
      // A run that did not get through (a step threw, or the outbox lost the connection part-way) must not hold off the next
      // attempt: the watcher counts a good probe as done and would not try again for the full gap.
      if (result.failedSteps.length > 0 || result.incomplete) lastStartedAt = null;
      return result;
    })
    .finally(() => {
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

  let incomplete = false;
  await step("outbox", async () => {
    const outcome = await deps.flushOutbox();
    if ((outcome as { stoppedOffline?: boolean } | null)?.stoppedOffline === true) incomplete = true;
  });
  await step("device_readings", deps.flushDeviceReadings);
  await step("photo_readings", deps.flushPhotoReadings);

  const [power, connection] = await Promise.all([deps.readPower(), deps.readConnection()]);
  const decision = workDecision({
    work: "upload_bulk",
    power,
    lowBatteryPercent: deps.lowBatteryPercent,
    lowData: deps.isLowData(),
    connection,
  });
  if (decision.action === "defer") {
    return { ran: true, bulk: decision.reason === "low_power" ? "deferred_low_power" : "deferred_low_data", failedSteps, incomplete };
  }
  await step("health_samples", deps.flushHealthSamples);
  return { ran: true, bulk: "sent", failedSteps, incomplete };
}

/**
 * Whether bulk uploads (queued health-store sample pages) would wait right now, and why. Computed live from the phone's
 * state, not remembered from an earlier run, so it is right in a background task's own JS context and goes away the
 * moment the cause does (plugged in, low-data mode off, back on Wi-Fi).
 */
export async function currentBulkDeferral(
  deps: Pick<ReconnectFlushDeps, "readPower" | "readConnection" | "isLowData" | "lowBatteryPercent"> = defaultReconnectFlushDeps()
): Promise<DeferReason | null> {
  const [power, connection] = await Promise.all([deps.readPower(), deps.readConnection()]);
  const decision = workDecision({ work: "upload_bulk", power, lowBatteryPercent: deps.lowBatteryPercent, lowData: deps.isLowData(), connection });
  return decision.action === "defer" ? decision.reason : null;
}

/** Entries waiting anywhere on the phone: the outbox plus the encrypted device, photo and health-sample queues. */
export async function getAllWaitingCount(): Promise<number> {
  const [outbox, queues] = await Promise.all([getOutboxPendingCount(), getOfflineQueuePendingCount()]);
  return outbox + queues;
}

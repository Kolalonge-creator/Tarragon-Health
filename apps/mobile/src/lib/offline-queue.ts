import AsyncStorage from "@react-native-async-storage/async-storage";
import { postDeviceReading, postHealthSamples } from "./api";
import type { HealthProvider } from "./health-sync";
import type { HealthReadingType, HealthSample } from "./healthkit";
import { recordSyncError, type SyncSource } from "./sync-diagnostics";

/**
 * Persisted store-and-forward queue for the two upload paths that previously
 * had nowhere to put a reading that failed to send other than dropping it:
 * health-store sync pages (health-sync.ts, one page of up to
 * UPLOAD_PAGE_SIZE HealthKit/Health Connect samples) and BLE clinical-device
 * readings (sync-screen.tsx, one reading at a time via api.ts's
 * postDeviceReading). Spec 55.13-55.15 — see CLAUDE.md's Device & Wearable
 * Integration section for why none of this has ever run against real
 * hardware yet.
 *
 * Two independent AsyncStorage-backed queues, not one combined queue: the
 * two call sites retry against different endpoints with structurally
 * different payloads (a whole page of samples vs. one device reading), and
 * giving each its own storage key and its own MAX_QUEUE_SIZE keeps a burst
 * from one producer from crowding out the other's own bounded space, rather
 * than the two sharing one budget.
 *
 * Deliberately no client-side conflict resolution here. Both target routes
 * already dedupe server-side on a stable key — device_id+external_reading_id
 * for /api/mobile/device-readings (unique index, 23505 -> {deduped:true}),
 * a per-row insert fallback keyed the same way for /api/mobile/health-samples
 * — so replaying a queued item that already reached the server is always
 * safe. "Deterministic conflict handling" (spec 55.15) is satisfied by that
 * existing idempotency once this queue reliably retries, not by any
 * resolution logic added here. See health-sync.ts / api.ts for the routes.
 */

const HEALTH_SAMPLES_QUEUE_KEY = "@tarragon/offline-queue/health-samples/v1";
const DEVICE_READINGS_QUEUE_KEY = "@tarragon/offline-queue/device-readings/v1";

/**
 * Cap per queue (not a combined budget — see file doc comment above).
 * Old, storage-constrained Nigerian Android devices are the target
 * condition here; a queue entry is small (a device reading is a handful of
 * numeric fields, a health-samples page is at most UPLOAD_PAGE_SIZE samples,
 * still low kilobytes as JSON), so 500 comfortably covers a multi-day full
 * outage at the background task's own ~15-minute-floor cadence without
 * risking meaningful device storage pressure.
 *
 * Drop-oldest on overflow, not reject-new: the newest reading is usually the
 * clinically freshest one — more likely to reflect the patient's current
 * state than something captured days into an outage — so it is the one
 * entry a full queue must never refuse to make room for. Reject-new would
 * mean the most urgent reading (e.g. a new BP reading taken because
 * something feels wrong) is silently the one dropped, which is the worse
 * failure mode of the two.
 */
const MAX_QUEUE_SIZE = 500;

export interface QueuedEntry<T> {
  id: string;
  enqueuedAt: string;
  item: T;
}

export interface QueuedHealthSamplesPage {
  provider: HealthProvider;
  samples: HealthSample[];
  /** The truncated-types declaration the page's original (failed) upload
   * carried — see health-sync.ts's upload loop. Preserved here so the flush
   * below replays it verbatim: the server's cursor clamp-and-hold only
   * converges if EVERY page of a paginated upload declares the same
   * truncation. Optional both because a non-truncated sync omits it and
   * because entries persisted by an app version predating this field won't
   * have it. */
  truncated_types?: HealthReadingType[];
}

/** A device-reading queue entry is the exact request body sync-screen.tsx
 * already builds for postDeviceReading — no separate shape needed. */
export type QueuedDeviceReading = Record<string, unknown>;

export interface FlushResult {
  flushed: number;
  remaining: number;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isQueuedEntry(value: unknown): value is QueuedEntry<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { enqueuedAt?: unknown }).enqueuedAt === "string" &&
    "item" in value
  );
}

/**
 * Generic persisted-list plumbing shared by both queues below. Not exported
 * — every caller outside this file goes through the health-samples- or
 * device-reading-specific functions further down, so the two queues can
 * never be pointed at each other's storage key by mistake.
 */
async function readQueue<T>(key: string, source: SyncSource): Promise<QueuedEntry<T>[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Filter rather than reject the whole queue on one bad entry — the same
    // "one broken thing must not cost every other item" principle
    // healthkit.ts/health-connect.ts already apply per reading type.
    return parsed.filter(isQueuedEntry) as QueuedEntry<T>[];
  } catch (error) {
    recordSyncError(source, "offline_queue:read", error);
    return [];
  }
}

/** Returns whether the write actually landed — callers that need to tell a
 * patient their reading is safely stored somewhere (sync-screen.tsx) check
 * this rather than assuming; callers doing a best-effort background flush
 * (everywhere else) can ignore it, since the failure is already recorded
 * here regardless. */
async function writeQueue<T>(key: string, entries: QueuedEntry<T>[], source: SyncSource): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entries));
    return true;
  } catch (error) {
    recordSyncError(source, "offline_queue:write", error);
    return false;
  }
}

async function appendToQueue<T>(key: string, item: T, source: SyncSource): Promise<boolean> {
  const entries = await readQueue<T>(key, source);
  const next = [...entries, { id: newId(), enqueuedAt: new Date().toISOString(), item }];
  if (next.length > MAX_QUEUE_SIZE) {
    // Drop-oldest — see MAX_QUEUE_SIZE's doc comment for why.
    next.splice(0, next.length - MAX_QUEUE_SIZE);
  }
  return writeQueue(key, next, source);
}

async function removeFromQueue<T>(key: string, id: string, source: SyncSource): Promise<void> {
  const entries = await readQueue<T>(key, source);
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length !== entries.length) {
    await writeQueue(key, next, source);
  }
}

// ---------------------------------------------------------------------------
// Health-samples queue
// ---------------------------------------------------------------------------

/** Returns whether the page was actually persisted — see writeQueue's doc
 * comment. health-sync.ts calls this best-effort (the failure is already
 * recorded internally either way); nothing more useful for it to do once a
 * fresh read has already happened and the live upload has already failed. */
export async function enqueueHealthSamplesPage(page: QueuedHealthSamplesPage): Promise<boolean> {
  return appendToQueue(HEALTH_SAMPLES_QUEUE_KEY, page, page.provider);
}

export async function listPendingHealthSamplesPages(): Promise<QueuedEntry<QueuedHealthSamplesPage>[]> {
  // "apple_health" here is just an attribution label for a read failure —
  // a corrupted queue file isn't specific to either provider.
  return readQueue<QueuedHealthSamplesPage>(HEALTH_SAMPLES_QUEUE_KEY, "apple_health");
}

export async function removeHealthSamplesPage(id: string): Promise<void> {
  await removeFromQueue<QueuedHealthSamplesPage>(HEALTH_SAMPLES_QUEUE_KEY, id, "apple_health");
}

export async function getHealthSamplesQueueCount(): Promise<number> {
  return (await listPendingHealthSamplesPages()).length;
}

export interface HealthSamplesFlushResult {
  /** Pages successfully uploaded and removed from the queue this call. */
  flushedPages: number;
  /** Individual samples across those pages — the more meaningful number to
   * show a patient ("recovered 12 readings"), a page being an upload-batch
   * implementation detail they never see elsewhere. */
  flushedSamples: number;
  /** Pages still queued afterwards, scoped the same way the flush itself
   * was (all pages, or just `onlyProvider`'s). */
  remaining: number;
}

/**
 * Retries every queued health-samples page against the real upload
 * endpoint, oldest first, removing each one that succeeds. Stops at the
 * first failure rather than working through the whole queue: on a still-
 * offline device every remaining page would fail the same way, each only
 * after its own ~20s timeout plus a retry (api.ts's REQUEST_TIMEOUT_MS /
 * RETRY_DELAY_MS) — burning through that budget for a queue of any real
 * size would cost the background task's own limited execution window (see
 * background-sync.ts) for no result. Whatever is left over is picked up by
 * the next call — the next background run, or the next manual/live sync.
 *
 * `onlyProvider` scopes the flush to one provider's pages, used by
 * syncAppleHealth/syncHealthConnect so a Health Connect sync doesn't spend
 * time retrying Apple Health's pages that happen to share this queue, and
 * vice versa. Omit it to flush everything, as background-sync.ts's periodic
 * task does via flushOfflineQueues.
 */
export async function flushHealthSamplesQueue(onlyProvider?: HealthProvider): Promise<HealthSamplesFlushResult> {
  const entries = await listPendingHealthSamplesPages();
  let flushedPages = 0;
  let flushedSamples = 0;

  for (const entry of entries) {
    if (onlyProvider && entry.item.provider !== onlyProvider) continue;
    const result = await postHealthSamples(
      entry.item.samples,
      entry.item.provider,
      entry.item.truncated_types
    );
    if (!result.ok) {
      recordSyncError(entry.item.provider, "offline_queue:flush", result.error);
      break;
    }
    await removeHealthSamplesPage(entry.id);
    flushedPages++;
    flushedSamples += entry.item.samples.length;
  }

  const remainingEntries = await listPendingHealthSamplesPages();
  const remaining = onlyProvider
    ? remainingEntries.filter((entry) => entry.item.provider === onlyProvider).length
    : remainingEntries.length;

  return { flushedPages, flushedSamples, remaining };
}

// ---------------------------------------------------------------------------
// Device-readings queue (BLE clinical devices)
// ---------------------------------------------------------------------------

const BLE_SOURCE: SyncSource = "ble";

/** Returns whether the reading was actually persisted — sync-screen.tsx
 * checks this to tell "saved, will upload later" (true) apart from the rare
 * case where the reading could not be sent *and* could not be queued (e.g.
 * device storage genuinely full), which is worth being honest with the
 * patient about rather than showing a false "queued". */
export async function enqueueDeviceReading(payload: QueuedDeviceReading): Promise<boolean> {
  return appendToQueue(DEVICE_READINGS_QUEUE_KEY, payload, BLE_SOURCE);
}

export async function listPendingDeviceReadings(): Promise<QueuedEntry<QueuedDeviceReading>[]> {
  return readQueue<QueuedDeviceReading>(DEVICE_READINGS_QUEUE_KEY, BLE_SOURCE);
}

export async function removeDeviceReading(id: string): Promise<void> {
  await removeFromQueue<QueuedDeviceReading>(DEVICE_READINGS_QUEUE_KEY, id, BLE_SOURCE);
}

export async function getDeviceReadingsQueueCount(): Promise<number> {
  return (await listPendingDeviceReadings()).length;
}

/** Same stop-on-first-failure reasoning as flushHealthSamplesQueue above —
 * one reading per entry here, so `flushed` already counts readings, not a
 * separate page/item distinction. */
export async function flushDeviceReadingsQueue(): Promise<FlushResult> {
  const entries = await listPendingDeviceReadings();
  let flushed = 0;

  for (const entry of entries) {
    const result = await postDeviceReading(entry.item);
    if (!result.success) {
      recordSyncError(BLE_SOURCE, "offline_queue:flush", result.error ?? "Upload failed");
      break;
    }
    await removeDeviceReading(entry.id);
    flushed++;
  }

  const remaining = (await listPendingDeviceReadings()).length;
  return { flushed, remaining };
}

// ---------------------------------------------------------------------------
// Combined helpers
// ---------------------------------------------------------------------------

/**
 * Flushes both queues in one call. Not currently wired into any call site —
 * background-sync.ts calls flushDeviceReadingsQueue directly instead and
 * lets syncAppleHealth/syncHealthConnect flush the health-samples queue
 * themselves (see that file), since running both flushes from here too
 * would just mean the health-samples one runs twice back to back for no
 * benefit. Kept as the one-call, drain-everything convenience for a future
 * caller that has no health sync of its own to piggyback on — a debug
 * screen's "flush now" action, or a NetInfo reconnect listener if one is
 * ever added (see background-sync.ts's own doc comment on why there isn't
 * one today).
 */
export async function flushOfflineQueues(): Promise<{
  healthSamples: HealthSamplesFlushResult;
  deviceReadings: FlushResult;
}> {
  const [healthSamples, deviceReadings] = await Promise.all([
    flushHealthSamplesQueue(),
    flushDeviceReadingsQueue(),
  ]);
  return { healthSamples, deviceReadings };
}

/**
 * Total pending items across both queues, for a developer holding the
 * device to check — the offline-queue equivalent of sync-diagnostics.ts's
 * ring buffer, and deliberately just as lightweight (no dedicated debug
 * screen exists in apps/mobile/src/screens today to surface this in; wire
 * it into one if/when one is built).
 */
export async function getPendingCount(): Promise<number> {
  const [healthSamples, deviceReadings] = await Promise.all([
    getHealthSamplesQueueCount(),
    getDeviceReadingsQueueCount(),
  ]);
  return healthSamples + deviceReadings;
}

import { postDeviceReading, postHealthSamples, postPhotoReading, type PhotoReadingRequest } from "./api";
import type { HealthProvider } from "./health-sync";
import type { HealthReadingType, HealthSample } from "./healthkit";
import { appendQueue, countQueue, listQueue, removeFromQueueStore, type QueueName } from "./offline-queue-store";
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
 * S06y: the queues live in the encrypted on-device store (offline-queue-store.ts), scoped to the
 * signed-in account, no longer in AsyncStorage. Independent queues, not one combined queue: the
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

const HEALTH_SAMPLES_QUEUE: QueueName = "health_samples";
const DEVICE_READINGS_QUEUE: QueueName = "device_readings";

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
// (The cap itself, MAX_QUEUE_SIZE = 500 per account and queue, is enforced in offline-queue-store.ts.)

/**
 * One flush of a given queue at a time. The reconnect trigger, the background task, a screen and the manual Sync button can
 * all ask at once; two runs listing the same entries would send them twice (the server dedupes, but the data and the race are
 * wasted). A later caller waits for the earlier one, then lists what is still there. A failed run does not block the chain.
 */
const flushChains = new Map<string, Promise<unknown>>();
function serialised<T>(name: string, run: () => Promise<T>): Promise<T> {
  const previous = flushChains.get(name) ?? Promise.resolve();
  const next = previous.then(run, run);
  flushChains.set(name, next.catch(() => undefined));
  return next;
}

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

async function readQueue<T>(queue: QueueName, source: SyncSource): Promise<QueuedEntry<T>[]> {
  return listQueue<T>(queue, source);
}

async function appendToQueue<T>(queue: QueueName, item: T, source: SyncSource): Promise<boolean> {
  return appendQueue<T>(queue, item, source);
}

async function removeFromQueue(queue: QueueName, id: string, source: SyncSource): Promise<void> {
  await removeFromQueueStore(queue, id, source);
}

// ---------------------------------------------------------------------------
// Health-samples queue
// ---------------------------------------------------------------------------

/** Returns whether the page was actually persisted — see writeQueue's doc
 * comment. health-sync.ts calls this best-effort (the failure is already
 * recorded internally either way); nothing more useful for it to do once a
 * fresh read has already happened and the live upload has already failed. */
export async function enqueueHealthSamplesPage(page: QueuedHealthSamplesPage): Promise<boolean> {
  return appendToQueue(HEALTH_SAMPLES_QUEUE, page, page.provider);
}

export async function listPendingHealthSamplesPages(): Promise<QueuedEntry<QueuedHealthSamplesPage>[]> {
  // "apple_health" here is just an attribution label for a read failure —
  // a corrupted queue file isn't specific to either provider.
  return readQueue<QueuedHealthSamplesPage>(HEALTH_SAMPLES_QUEUE, "apple_health");
}

export async function removeHealthSamplesPage(id: string): Promise<void> {
  await removeFromQueue(HEALTH_SAMPLES_QUEUE, id, "apple_health");
}

export async function getHealthSamplesQueueCount(): Promise<number> {
  return countQueue(HEALTH_SAMPLES_QUEUE, "apple_health");
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
export function flushHealthSamplesQueue(onlyProvider?: HealthProvider): Promise<HealthSamplesFlushResult> {
  return serialised("health_samples", () => runHealthSamplesFlush(onlyProvider));
}

async function runHealthSamplesFlush(onlyProvider?: HealthProvider): Promise<HealthSamplesFlushResult> {
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
  return appendToQueue(DEVICE_READINGS_QUEUE, payload, BLE_SOURCE);
}

export async function listPendingDeviceReadings(): Promise<QueuedEntry<QueuedDeviceReading>[]> {
  return readQueue<QueuedDeviceReading>(DEVICE_READINGS_QUEUE, BLE_SOURCE);
}

export async function removeDeviceReading(id: string): Promise<void> {
  await removeFromQueue(DEVICE_READINGS_QUEUE, id, BLE_SOURCE);
}

export async function getDeviceReadingsQueueCount(): Promise<number> {
  return countQueue(DEVICE_READINGS_QUEUE, BLE_SOURCE);
}

/** Same stop-on-first-failure reasoning as flushHealthSamplesQueue above —
 * one reading per entry here, so `flushed` already counts readings, not a
 * separate page/item distinction. */
export function flushDeviceReadingsQueue(): Promise<FlushResult> {
  return serialised("device_readings", runDeviceReadingsFlush);
}

async function runDeviceReadingsFlush(): Promise<FlushResult> {
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
// Photo-readings queue (S70a, 18.3)
// ---------------------------------------------------------------------------

const PHOTO_READINGS_QUEUE: QueueName = "photo_readings";
const PHOTO_SOURCE: SyncSource = "ble";

/**
 * A reading the person photographed and confirmed digit by digit, waiting for a connection. The entry holds the confirmed NUMBERS only, never
 * the photo. Replaying is safe: the server dedupes on `client_reading_id` (an already-saved reading answers {deduped:true}).
 */
export async function enqueuePhotoReading(payload: PhotoReadingRequest): Promise<boolean> {
  return appendToQueue(PHOTO_READINGS_QUEUE, payload, PHOTO_SOURCE);
}

export async function listPendingPhotoReadings(): Promise<QueuedEntry<PhotoReadingRequest>[]> {
  return readQueue<PhotoReadingRequest>(PHOTO_READINGS_QUEUE, PHOTO_SOURCE);
}

export async function getPhotoReadingsQueueCount(): Promise<number> {
  return countQueue(PHOTO_READINGS_QUEUE, PHOTO_SOURCE);
}

/**
 * Stops at the first outage (every later entry would fail the same way). A reading the server REFUSES (400 invalid, 422 too old) is dropped
 * from the queue and recorded, because retrying a refusal forever would block every reading behind it; every other failure keeps the entry,
 * including 404 (the switch is off for now and may be switched on) and 5xx.
 */
export function flushPhotoReadingsQueue(): Promise<FlushResult> {
  return serialised("photo_readings", runPhotoReadingsFlush);
}

async function runPhotoReadingsFlush(): Promise<FlushResult> {
  const entries = await listPendingPhotoReadings();
  let flushed = 0;

  for (const entry of entries) {
    const result = await postPhotoReading(entry.item);
    if (!result.ok) {
      recordSyncError(PHOTO_SOURCE, "offline_queue:flush", result.error);
      if (result.status === 400 || result.status === 422) {
        await removeFromQueue(PHOTO_READINGS_QUEUE, entry.id, PHOTO_SOURCE);
        continue;
      }
      break;
    }
    await removeFromQueue(PHOTO_READINGS_QUEUE, entry.id, PHOTO_SOURCE);
    flushed++;
  }

  const remaining = (await listPendingPhotoReadings()).length;
  return { flushed, remaining };
}

// ---------------------------------------------------------------------------
// Combined helpers
// ---------------------------------------------------------------------------

/**
 * Flushes both queues in one call. background-sync.ts's periodic task still
 * calls flushDeviceReadingsQueue directly and lets syncAppleHealth/
 * syncHealthConnect flush the health-samples queue themselves (running both
 * flushes from here too on every background tick would just mean the
 * health-samples one runs twice back to back for no benefit) — this
 * combined helper is instead the patient-facing "Sync now" action on
 * DevicesScreen, for someone who's just back online and doesn't want to
 * wait for the background task's own ~15-minute floor.
 */
export async function flushOfflineQueues(): Promise<{
  healthSamples: HealthSamplesFlushResult;
  deviceReadings: FlushResult;
  photoReadings: FlushResult;
}> {
  const [healthSamples, deviceReadings, photoReadings] = await Promise.all([
    flushHealthSamplesQueue(),
    flushDeviceReadingsQueue(),
    flushPhotoReadingsQueue(),
  ]);
  return { healthSamples, deviceReadings, photoReadings };
}

/**
 * Total pending items across both queues — surfaced on DevicesScreen as
 * "N readings saved on this device, waiting to sync," the same visibility
 * pattern VitalsScreen already gives its own offline queue.
 */
export async function getPendingCount(): Promise<number> {
  const [healthSamples, deviceReadings, photoReadings] = await Promise.all([
    getHealthSamplesQueueCount(),
    getDeviceReadingsQueueCount(),
    getPhotoReadingsQueueCount(),
  ]);
  return healthSamples + deviceReadings + photoReadings;
}

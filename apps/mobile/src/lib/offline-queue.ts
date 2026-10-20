import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as SQLite from "expo-sqlite";
import { getStoreWithSchema } from "./secure-db";
import { postDeviceReading, postHealthSamples, postPhotoReading, type PhotoReadingRequest } from "./api";
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
 * Independent queues (encrypted store since S06y), not one combined queue: the
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
 * Generic persisted-list plumbing shared by the three queues below. Not exported
 * — every caller outside this file goes through the health-samples-, device-reading-
 * and photo-reading-specific functions further down, so the queues can never be
 * pointed at each other's storage key by mistake.
 *
 * S06y: the entries live in the ENCRYPTED on-device store (SQLCipher, secure-db.ts), table
 * `offline_queue`, not in AsyncStorage. The AsyncStorage key of each queue is kept as the queue's
 * NAME in that table, and as the place an older build left its plaintext copy: the first time a
 * queue is touched on a given store handle, any such copy is moved across (oldest first, ahead of
 * anything new) and the plaintext key is removed. The remote wipe deletes the whole store file, so
 * it covers these queues with no extra step.
 */
async function setupQueueTable(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `create table if not exists offline_queue (
       seq integer primary key,
       queue text not null,
       id text not null,
       enqueued_at text not null,
       item text not null,
       unique (queue, id)
     );
     create index if not exists offline_queue_by_queue on offline_queue (queue, seq);`
  );
}

/**
 * All-or-nothing writes. Same pattern as outbox.ts: an exclusive transaction first (a plain transaction on the shared
 * connection would pull a concurrent outbox write into this one, and roll it back with it on failure), and on a lock
 * conflict one retry on the main connection. A real failure fails both and is thrown.
 */
async function atomically(db: SQLite.SQLiteDatabase, label: string, source: SyncSource, work: (conn: SQLite.SQLiteDatabase) => Promise<void>): Promise<void> {
  try {
    await db.withExclusiveTransactionAsync(work);
  } catch (error) {
    recordSyncError(source, `offline_queue:${label}:exclusiveTransaction`, error);
    await db.withTransactionAsync(() => work(db));
  }
}

const migrated = new WeakMap<object, Map<string, Promise<void>>>();

/** Moves the plaintext copy an older build left in AsyncStorage into the encrypted table. Throws only when the copy itself failed (it is retried). */
async function migrateLegacy(db: SQLite.SQLiteDatabase, key: string, source: SyncSource): Promise<void> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Unreadable: left where it is (it is not ours to destroy) and recorded. The remote wipe still removes it.
    recordSyncError(source, "offline_queue:read", error);
    return;
  }
  if (!Array.isArray(parsed)) {
    recordSyncError(source, "offline_queue:read", "queue was not a list");
    return;
  }
  // One bad entry must not cost every other item (the same rule healthkit.ts applies per reading type).
  const good = parsed.filter(isQueuedEntry) as QueuedEntry<unknown>[];
  if (good.length !== parsed.length) {
    recordSyncError(source, "offline_queue:migrate", `${parsed.length - good.length} malformed queue entr${parsed.length - good.length === 1 ? "y" : "ies"} could not be moved and were left behind`);
  }
  await atomically(db, "migrate", source, async (conn) => {
    for (const entry of good) {
      await conn.runAsync("insert or ignore into offline_queue (queue, id, enqueued_at, item) values (?, ?, ?, ?)", [
        key,
        entry.id,
        entry.enqueuedAt,
        JSON.stringify(entry.item),
      ]);
    }
  });
  // Only after every good entry is in the encrypted table is the plaintext copy removed.
  await AsyncStorage.removeItem(key);
}

async function queueDb(key: string, source: SyncSource): Promise<SQLite.SQLiteDatabase> {
  const db = await getStoreWithSchema("offline_queue", setupQueueTable);
  let perDb = migrated.get(db);
  if (!perDb) {
    perDb = new Map();
    migrated.set(db, perDb);
  }
  let done = perDb.get(key);
  if (!done) {
    done = migrateLegacy(db, key, source).catch((error) => {
      perDb?.delete(key); // try again on the next call; the plaintext copy stays where it is until the move succeeds
      recordSyncError(source, "offline_queue:migrate", error);
      throw error;
    });
    perDb.set(key, done);
  }
  await done;
  return db;
}

async function readQueue<T>(key: string, source: SyncSource): Promise<QueuedEntry<T>[]> {
  try {
    const db = await queueDb(key, source);
    const rows = await db.getAllAsync<{ id: string; enqueued_at: string; item: string }>(
      "select id, enqueued_at, item from offline_queue where queue = ? order by seq",
      [key]
    );
    const out: QueuedEntry<T>[] = [];
    for (const row of rows) {
      try {
        out.push({ id: row.id, enqueuedAt: row.enqueued_at, item: JSON.parse(row.item) as T });
      } catch (error) {
        recordSyncError(source, "offline_queue:read", error);
      }
    }
    return out;
  } catch (error) {
    recordSyncError(source, "offline_queue:read", error);
    // The encrypted store cannot be opened right now. An older build's plaintext copy (if any) is still the truth for
    // those entries: show it, so counts, the reconnect trigger and the flush keep working. New entries are not written
    // there (appendToQueue reports false instead).
    return readLegacyEntries<T>(key);
  }
}

async function readLegacyEntries<T>(key: string): Promise<QueuedEntry<T>[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(isQueuedEntry) as QueuedEntry<T>[]) : [];
  } catch {
    return [];
  }
}

/** Returns whether the write actually landed — callers that need to tell a
 * patient their reading is safely stored somewhere (sync-screen.tsx) check
 * this rather than assuming; callers doing a best-effort background flush
 * (everywhere else) can ignore it, since the failure is already recorded
 * here regardless. */
async function appendToQueue<T>(key: string, item: T, source: SyncSource): Promise<boolean> {
  try {
    const db = await queueDb(key, source);
    let dropped: { enqueued_at: string }[] = [];
    const id = newId();
    const enqueuedAt = new Date().toISOString();
    await atomically(db, "append", source, async (conn) => {
      dropped = [];
      await conn.runAsync("insert into offline_queue (queue, id, enqueued_at, item) values (?, ?, ?, ?)", [
        key,
        id,
        enqueuedAt,
        JSON.stringify(item),
      ]);
      const count = (await conn.getFirstAsync<{ n: number }>("select count(*) as n from offline_queue where queue = ?", [key]))?.n ?? 0;
      if (count > MAX_QUEUE_SIZE) {
        // Drop-oldest — see MAX_QUEUE_SIZE's doc comment for why the NEWEST reading is the one a full queue must never refuse.
        dropped = await conn.getAllAsync<{ enqueued_at: string }>(
          "select enqueued_at from offline_queue where queue = ? order by seq limit ?",
          [key, count - MAX_QUEUE_SIZE]
        );
        await conn.runAsync(
          "delete from offline_queue where seq in (select seq from offline_queue where queue = ? order by seq limit ?)",
          [key, count - MAX_QUEUE_SIZE]
        );
      }
    });
    if (dropped.length > 0) {
      // The discard itself is recorded rather than silent: losing a queued clinical reading is exactly the kind of event that
      // must be visible to whoever is holding the device when this path first runs for real. The policy is unchanged; only its visibility is.
      recordSyncError(
        source,
        "offline_queue:overflow",
        `Queue full (${MAX_QUEUE_SIZE}); discarded ${dropped.length} oldest entr${dropped.length === 1 ? "y" : "ies"} (oldest enqueued ${dropped[0]?.enqueued_at}).`
      );
    }
    return true;
  } catch (error) {
    recordSyncError(source, "offline_queue:write", error);
    return false;
  }
}

async function removeFromQueue(key: string, id: string, source: SyncSource): Promise<void> {
  try {
    const db = await queueDb(key, source);
    await db.runAsync("delete from offline_queue where queue = ? and id = ?", [key, id]);
  } catch (error) {
    recordSyncError(source, "offline_queue:write", error);
    // Store unavailable: take the entry out of a leftover plaintext copy so it is not sent again.
    try {
      if ((await AsyncStorage.getItem(key)) !== null) {
        const left = (await readLegacyEntries<unknown>(key)).filter((entry) => entry.id !== id);
        await AsyncStorage.setItem(key, JSON.stringify(left));
      }
    } catch {
      // nothing more to do: the entry stays and the server dedupes a repeat
    }
  }
}

/**
 * One flush of a given queue at a time. The reconnect trigger, the background task, a screen and the manual Sync button can
 * all ask at once; two runs listing the same entries would send them twice. A later caller waits for the earlier one, then
 * lists what is still there.
 */
const flushChains = new Map<string, Promise<unknown>>();
function serialised<T>(name: string, run: () => Promise<T>): Promise<T> {
  const previous = flushChains.get(name) ?? Promise.resolve();
  const next = previous.then(run, run);
  flushChains.set(name, next.catch(() => undefined));
  return next;
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
  await removeFromQueue(HEALTH_SAMPLES_QUEUE_KEY, id, "apple_health");
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
  return appendToQueue(DEVICE_READINGS_QUEUE_KEY, payload, BLE_SOURCE);
}

export async function listPendingDeviceReadings(): Promise<QueuedEntry<QueuedDeviceReading>[]> {
  return readQueue<QueuedDeviceReading>(DEVICE_READINGS_QUEUE_KEY, BLE_SOURCE);
}

export async function removeDeviceReading(id: string): Promise<void> {
  await removeFromQueue(DEVICE_READINGS_QUEUE_KEY, id, BLE_SOURCE);
}

export async function getDeviceReadingsQueueCount(): Promise<number> {
  return (await listPendingDeviceReadings()).length;
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

const PHOTO_READINGS_QUEUE_KEY = "@tarragon/offline-queue/photo-readings/v1";
const PHOTO_SOURCE: SyncSource = "ble";

/**
 * A reading the person photographed and confirmed digit by digit, waiting for a connection. The entry holds the confirmed NUMBERS only, never
 * the photo. Replaying is safe: the server dedupes on `client_reading_id` (an already-saved reading answers {deduped:true}).
 */
export async function enqueuePhotoReading(payload: PhotoReadingRequest): Promise<boolean> {
  return appendToQueue(PHOTO_READINGS_QUEUE_KEY, payload, PHOTO_SOURCE);
}

export async function listPendingPhotoReadings(): Promise<QueuedEntry<PhotoReadingRequest>[]> {
  return readQueue<PhotoReadingRequest>(PHOTO_READINGS_QUEUE_KEY, PHOTO_SOURCE);
}

export async function getPhotoReadingsQueueCount(): Promise<number> {
  return (await listPendingPhotoReadings()).length;
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
        await removeFromQueue(PHOTO_READINGS_QUEUE_KEY, entry.id, PHOTO_SOURCE);
        continue;
      }
      break;
    }
    await removeFromQueue(PHOTO_READINGS_QUEUE_KEY, entry.id, PHOTO_SOURCE);
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

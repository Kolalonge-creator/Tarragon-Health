import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as SQLite from "expo-sqlite";
import { getStoreWithSchema } from "./secure-db";
import { recordSyncError } from "./sync-diagnostics";

/**
 * Small keyed values kept in the ENCRYPTED on-device store (S06x follow-up), for what used to sit in plaintext AsyncStorage: the upload queues
 * for device and health-store readings, the remembered BP target, and the on-device triage facts.
 *
 * A key can have up to three homes, and the rules below exist so that no queued reading is ever lost to a move, a failure or a race:
 *   S  the encrypted row (the home).
 *   L  the plaintext copy an older build left in AsyncStorage under the same key (oldest).
 *   F  a fallback copy, written to AsyncStorage under `<key>#fb` ONLY when the encrypted store could not be used (newest).
 * `get` combines whatever exists: for a queue (a `merge` is given) the union of all of them; for a plain value F wins over S, and S over L.
 * It then writes the combined value into S, READS IT BACK, and only when the read-back matches removes the copies it actually read. A copy that
 * could not be read (a timeout or an error) is left alone, never removed on a guess. If S could not be read at all, `set` does not write S
 * (that could replace a good row with a short one): it writes F, and the next good read merges everything. `set` removes F and L only after S
 * holds the new value, and for a queue it merges them in first, so nothing is destroyed unsent; a replayed queue entry is harmless because
 * the server dedupes on a stable key. `remove` leaves a tombstone in F when the encrypted delete fails, so a removed value cannot come back.
 *
 * Operations on one key run one at a time (`update` holds the lock across a read and the write that follows, so two appends cannot lose each
 * other). A waiter gives up on a stuck predecessor after LOCK_WAIT_MS, a plaintext read after LEGACY_READ_MS, and opening the store after
 * STORE_OPEN_MS, so a hung storage call can slow a caller but never block a key for good.
 *
 * Not for secrets, and not for values the wipe must keep (notices, the data meter, lease records stay in AsyncStorage).
 */

const TABLE = "local_kv";
const FALLBACK_SUFFIX = "#fb";
const TOMBSTONE = "__removed__";

/** A waiter gives up on the operation ahead of it after this long and goes on. */
const LOCK_WAIT_MS = 3000;
/** A plaintext AsyncStorage read that has not answered by now is "unknown", recorded, and the lock is released. */
const LEGACY_READ_MS = 1500;
/** Opening the encrypted store (the first open may be doing the one-time copy) is not waited on for ever. */
const STORE_OPEN_MS = 10_000;

/** Resolves with the promise's value, or with `onTimeout` after `ms`; the timer is cleared as soon as the promise settles. */
async function within<T, F>(promise: Promise<T>, ms: number, onTimeout: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), ms);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function setupKv(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`create table if not exists ${TABLE} (key text primary key, value text not null)`);
}

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await within(getStoreWithSchema("kv", setupKv), STORE_OPEN_MS, null);
  if (!db) throw new Error("The encrypted store did not open in time");
  return db;
}

const locks = new Map<string, Promise<unknown>>();

/** One operation at a time per key, so a migration and a write for the same key cannot interleave (bounded: see LOCK_WAIT_MS). */
function withKeyLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = within(previous.catch(() => undefined), LOCK_WAIT_MS, undefined).then(run);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return next;
}

/** Combines two values of one key; the first is older. */
export type KvMerge = (older: string, newer: string) => string;

/** Keys whose encrypted row could not be read on the last try: `set` must not write the row for these (it could replace a good one). */
const storeUnreadable = new Set<string>();

type Copy = { state: "none" } | { state: "unknown" } | { state: "value"; value: string };

async function readPlain(name: string): Promise<Copy> {
  try {
    const answer = await within(AsyncStorage.getItem(name), LEGACY_READ_MS, "__timeout__" as const);
    if (answer === "__timeout__") {
      recordSyncError("offline_outbox", "kv:plainRead", "AsyncStorage did not answer in time");
      return { state: "unknown" };
    }
    return answer === null ? { state: "none" } : { state: "value", value: answer };
  } catch (error) {
    recordSyncError("offline_outbox", "kv:plainRead", error);
    return { state: "unknown" };
  }
}

async function removePlain(name: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(name);
  } catch (error) {
    recordSyncError("offline_outbox", "kv:plainRemove", error);
  }
}

async function readRow(db: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(`select value from ${TABLE} where key = ?`, [key]);
  return row?.value ?? null;
}

/** Writes the row and reads it back. True only when the read-back is exactly what was written. */
async function writeRowVerified(db: SQLite.SQLiteDatabase, key: string, value: string): Promise<boolean> {
  await db.runAsync(`insert or replace into ${TABLE} (key, value) values (?, ?)`, [key, value]);
  return (await readRow(db, key)) === value;
}

async function getUnlocked(key: string, merge?: KvMerge): Promise<string | null> {
  const fbName = key + FALLBACK_SUFFIX;
  let db: SQLite.SQLiteDatabase | null = null;
  let row: string | null = null;
  try {
    db = await openDb();
    row = await readRow(db, key);
    storeUnreadable.delete(key);
  } catch (error) {
    recordSyncError("offline_outbox", "kv:storeRead", error);
    storeUnreadable.add(key);
    db = null;
  }

  const [legacy, fallback] = await Promise.all([readPlain(key), readPlain(fbName)]);
  const removed = fallback.state === "value" && fallback.value === TOMBSTONE;
  const fbValue = fallback.state === "value" && !removed ? fallback.value : null;

  // Oldest first: L, then S, then F. A queue keeps everything; a plain value takes the newest. A tombstone is the newest of all.
  let value: string | null = null;
  if (!removed) {
    const layer = (next: string | null) => {
      if (next === null) return;
      value = value === null ? next : merge ? merge(value, next) : next;
    };
    layer(legacy.state === "value" ? legacy.value : null);
    layer(row);
    layer(fbValue);
  }

  if (!db) return value; // cannot tidy up without a readable store; every copy stays where it is

  try {
    if (removed) {
      await db.runAsync(`delete from ${TABLE} where key = ?`, [key]);
      await removePlain(fbName);
      if (legacy.state === "value") await removePlain(key);
      return null;
    }
    if (value !== null && value !== row && !(await writeRowVerified(db, key, value))) {
      throw new Error("The encrypted copy did not read back the same");
    }
    // Remove only the copies that were actually read and are now inside the verified row.
    if (legacy.state === "value") await removePlain(key);
    if (fallback.state === "value") await removePlain(fbName);
  } catch (error) {
    recordSyncError("offline_outbox", "kv:migrate", error);
  }
  return value;
}

async function setUnlocked(key: string, next: string, merge?: KvMerge): Promise<boolean> {
  const fbName = key + FALLBACK_SUFFIX;
  if (!storeUnreadable.has(key)) {
    try {
      const db = await openDb();
      // Copies still around (an interrupted move, or a fallback): a queue keeps their entries, a plain value is replaced.
      const [legacy, fallback] = await Promise.all([readPlain(key), readPlain(fbName)]);
      let value = next;
      if (merge) {
        if (legacy.state === "value") value = merge(legacy.value, value);
        if (fallback.state === "value" && fallback.value !== TOMBSTONE) value = merge(fallback.value, value);
      }
      if (await writeRowVerified(db, key, value)) {
        if (legacy.state === "value") await removePlain(key);
        if (fallback.state === "value") await removePlain(fbName);
        return true;
      }
      recordSyncError("offline_outbox", "kv:storeWrite", "The encrypted copy did not read back the same");
    } catch (error) {
      recordSyncError("offline_outbox", "kv:storeWrite", error);
    }
  }
  // The store cannot be used right now: keep the value where a later good read will find and merge it.
  try {
    await AsyncStorage.setItem(fbName, next);
    return true;
  } catch (error) {
    recordSyncError("offline_outbox", "kv:fallbackWrite", error);
    return false;
  }
}

async function removeUnlocked(key: string): Promise<void> {
  const fbName = key + FALLBACK_SUFFIX;
  let deleted = false;
  if (!storeUnreadable.has(key)) {
    try {
      const db = await openDb();
      await db.runAsync(`delete from ${TABLE} where key = ?`, [key]);
      deleted = true;
    } catch (error) {
      recordSyncError("offline_outbox", "kv:storeRemove", error);
    }
  }
  await removePlain(key);
  if (deleted) {
    await removePlain(fbName);
    return;
  }
  // The encrypted row may still exist: say so, so a later good read deletes it instead of bringing it back.
  try {
    await AsyncStorage.setItem(fbName, TOMBSTONE);
  } catch (error) {
    recordSyncError("offline_outbox", "kv:tombstone", error);
  }
}

export function secureKvGet(key: string, merge?: KvMerge): Promise<string | null> {
  return withKeyLock(key, () => getUnlocked(key, merge));
}

/**
 * Replaces the value. Returns whether it landed somewhere durable (the encrypted store, or the fallback copy when the store cannot be used).
 * Never throws. For a queue, pass `merge` so copies from an older build or a fallback are kept.
 */
export function secureKvSet(key: string, value: string, merge?: KvMerge): Promise<boolean> {
  return withKeyLock(key, () => setUnlocked(key, value, merge));
}

export function secureKvRemove(key: string): Promise<void> {
  return withKeyLock(key, () => removeUnlocked(key));
}

/**
 * Read, change and write back as ONE step under the key's lock, so two callers appending to the same queue cannot lose each other's entry.
 * `change` gets the current value (null if none) and returns the new one, or null to leave the value as it is. Resolves to whether the change
 * landed (true also when `change` asked for no change).
 */
export function secureKvUpdate(key: string, merge: KvMerge | undefined, change: (current: string | null) => string | null): Promise<boolean> {
  return withKeyLock(key, async () => {
    const current = await getUnlocked(key, merge);
    const next = change(current);
    if (next === null) return true;
    return setUnlocked(key, next, merge);
  });
}

interface QueueLike {
  id?: unknown;
  enqueuedAt?: unknown;
}

/** Union of two JSON arrays of `{ id, enqueuedAt }` entries, by id (the second argument wins on a clash), oldest first. */
export function mergeQueueJson(older: string, newer: string): string {
  const parse = (raw: string): QueueLike[] => {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? (v as QueueLike[]) : [];
    } catch {
      return [];
    }
  };
  const byId = new Map<string, QueueLike>();
  const loose: QueueLike[] = [];
  for (const entry of [...parse(older), ...parse(newer)]) {
    if (entry && typeof entry.id === "string") byId.set(entry.id, entry);
    else loose.push(entry);
  }
  const merged = [...byId.values(), ...loose];
  merged.sort((a, b) => String(a.enqueuedAt ?? "").localeCompare(String(b.enqueuedAt ?? "")));
  return JSON.stringify(merged);
}

/** Test hook: forgets which keys were unreadable and drops any lock state. */
export function __resetKvForTests(): void {
  storeUnreadable.clear();
  locks.clear();
}

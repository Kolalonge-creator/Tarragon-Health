import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as SQLite from "expo-sqlite";
import { getStoreWithSchema } from "./secure-db";
import { recordSyncError } from "./sync-diagnostics";

/**
 * Small keyed values kept in the ENCRYPTED on-device store (S06x follow-up), for what used to sit in plaintext AsyncStorage:
 * the upload queues for device and health-store readings, the remembered BP target, and the on-device triage facts.
 *
 * Moving a value across is "copy, verify, then remove", never "move":
 *  1. read the encrypted row, then any copy an older build left in AsyncStorage (the legacy copy);
 *  2. when a legacy copy exists, write the value into the store, read it back, and only when the read-back equals what was
 *     written remove the legacy copy. A failed write or a read-back that differs leaves the legacy copy where it is and the
 *     value is still returned, so a queued reading is never lost to a migration;
 *  3. when both copies exist (a crash between the write and the remove, or a write that had to fall back), `merge` decides.
 *     Queues pass a union-by-id merge, so neither side's entries are dropped.
 *
 * If the encrypted store cannot be opened at all, reads and writes fall back to AsyncStorage (exactly what the app did before)
 * and the failure is recorded: a patient's unsent reading is worth more than a tidy storage story. The store itself can run in
 * "plain" mode when SQLCipher is missing; the patient is already told that by secure-db.ts.
 *
 * Writes are a full replace of the value. Callers that append read the value first, which also finishes any pending migration.
 * Not for secrets, and not for values the wipe must keep (notices, the data meter, lease records stay in AsyncStorage).
 */

const TABLE = "local_kv";

async function setupKv(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`create table if not exists ${TABLE} (key text primary key, value text not null)`);
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  return getStoreWithSchema("kv", setupKv);
}

const locks = new Map<string, Promise<unknown>>();

/** A hung storage call must never lock a key for good: a waiter gives up on the one ahead of it after this long and goes on. */
const LOCK_WAIT_MS = 3000;
/** A legacy AsyncStorage read that has not answered by now is treated as "no legacy copy", recorded, and the lock is released. */
const LEGACY_READ_MS = 1500;

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

export type KvMerge = (storeValue: string, legacyValue: string) => string;

async function readLegacy(key: string): Promise<string | null> {
  try {
    const answer = await within(AsyncStorage.getItem(key), LEGACY_READ_MS, "__timeout__" as const);
    if (answer === "__timeout__") {
      recordSyncError("offline_outbox", "kv:legacyRead", "AsyncStorage did not answer in time");
      return null;
    }
    return answer;
  } catch (error) {
    recordSyncError("offline_outbox", "kv:legacyRead", error);
    return null;
  }
}

export function secureKvGet(key: string, merge?: KvMerge): Promise<string | null> {
  return withKeyLock(key, async () => {
    let db: SQLite.SQLiteDatabase;
    let row: { value: string } | null;
    try {
      db = await getDb();
      row = await db.getFirstAsync<{ value: string }>(`select value from ${TABLE} where key = ?`, [key]);
    } catch (error) {
      recordSyncError("offline_outbox", "kv:storeRead", error);
      return readLegacy(key);
    }

    const legacy = await readLegacy(key);
    if (legacy === null) return row?.value ?? null;

    const value = row ? (merge ? merge(row.value, legacy) : row.value) : legacy;
    try {
      if (!row || value !== row.value) {
        await db.runAsync(`insert or replace into ${TABLE} (key, value) values (?, ?)`, [key, value]);
      }
      const back = await db.getFirstAsync<{ value: string }>(`select value from ${TABLE} where key = ?`, [key]);
      if (back?.value !== value) throw new Error("The encrypted copy did not read back the same");
      // Only now is the plaintext copy safe to remove. A failed remove leaves a duplicate, never a loss.
      await AsyncStorage.removeItem(key);
    } catch (error) {
      recordSyncError("offline_outbox", "kv:migrate", error);
    }
    return value;
  });
}

/**
 * Replaces the value. Returns whether it landed somewhere durable (the encrypted store, or AsyncStorage when the store is
 * unavailable). Never throws.
 */
export function secureKvSet(key: string, value: string): Promise<boolean> {
  return withKeyLock(key, async () => {
    try {
      const db = await getDb();
      await db.runAsync(`insert or replace into ${TABLE} (key, value) values (?, ?)`, [key, value]);
    } catch (error) {
      recordSyncError("offline_outbox", "kv:storeWrite", error);
      try {
        await AsyncStorage.setItem(key, value);
        return true;
      } catch (fallbackError) {
        recordSyncError("offline_outbox", "kv:fallbackWrite", fallbackError);
        return false;
      }
    }
    // The store now holds the newest value; a stale plaintext copy must not outlive it.
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      recordSyncError("offline_outbox", "kv:legacyRemove", error);
    }
    return true;
  });
}

export function secureKvRemove(key: string): Promise<void> {
  return withKeyLock(key, async () => {
    try {
      const db = await getDb();
      await db.runAsync(`delete from ${TABLE} where key = ?`, [key]);
    } catch (error) {
      recordSyncError("offline_outbox", "kv:storeRemove", error);
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      recordSyncError("offline_outbox", "kv:legacyRemove", error);
    }
  });
}

interface QueueLike {
  id?: unknown;
  enqueuedAt?: unknown;
}

/** Union of two JSON arrays of `{ id, enqueuedAt }` entries, by id (the store's copy wins on a clash), oldest first. */
export function mergeQueueJson(storeValue: string, legacyValue: string): string {
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
  for (const entry of [...parse(legacyValue), ...parse(storeValue)]) {
    if (entry && typeof entry.id === "string") byId.set(entry.id, entry);
    else loose.push(entry);
  }
  const merged = [...byId.values(), ...loose];
  merged.sort((a, b) => String(a.enqueuedAt ?? "").localeCompare(String(b.enqueuedAt ?? "")));
  return JSON.stringify(merged);
}

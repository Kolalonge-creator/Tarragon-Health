import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { getStoreWithSchema } from "./secure-db";
import { addStoreNotice } from "./store-notices";
import { eventCode, rowsChecksum } from "./store-rules";
import { recordSyncError, type SyncSource } from "./sync-diagnostics";
import { supabase } from "./supabase";

/**
 * Storage behind offline-queue.ts (S06y). The three upload queues (health-store sync pages, BLE device
 * readings, photo-confirmed readings) used to be JSON lists in AsyncStorage, in clear. They now live in the
 * one SQLCipher store (secure-db.ts), one row per entry, scoped to the account that queued it.
 *
 * Safety rules, in order of importance:
 *  1. A queued entry is never dropped by the move. The old AsyncStorage list is copied inside ONE
 *     transaction, read back and compared (row count and an order-sensitive checksum) before the transaction
 *     commits; only then is the old key removed. A mismatch rolls the copy back, keeps the old key, and shows
 *     the patient the existing "kept safe, not locked yet" notice. While the old key is kept, readers still
 *     see its entries (the escape hatch), so a held copy never strands a reading.
 *  2. A damaged old list is not discarded either: an entry that cannot be read, or a file that is not a list,
 *     is copied as an opaque row (never listed, never uploaded) so it stays encrypted and is wiped with the
 *     store rather than lingering in clear.
 *  3. Entries from before this change have no account. They are claimed by the first signed-in account that
 *     touches the queue, which is exactly who would have uploaded them before.
 *  4. If the store cannot be opened, the write fails and says so (enqueue returns false). Nothing falls back to
 *     AsyncStorage: that would put a health reading back in clear. Reads still show an old list that has not been
 *     moved, so a waiting reading never looks synced. If S06x had to fall back to its PLAIN file (no keystore or no
 *     SQLCipher in the build) the queue lives in that file and the patient has already been told "not encrypted".
 *     Offline with an expired token the queue keeps using the last account seen (see sessionUserId).
 *  5. The remote wipe removes the store file, so these rows go with it; it also removes any old AsyncStorage
 *     list that is still waiting to be moved.
 */

export type QueueName = "health_samples" | "device_readings" | "photo_readings";

export const LEGACY_QUEUE_KEYS: Record<QueueName, string> = {
  health_samples: "@tarragon/offline-queue/health-samples/v1",
  device_readings: "@tarragon/offline-queue/device-readings/v1",
  photo_readings: "@tarragon/offline-queue/photo-readings/v1",
};

export interface StoredEntry<T> {
  id: string;
  enqueuedAt: string;
  item: T;
}

const UNCLAIMED = "";
/** Opaque rows sort first so they never interleave with readable entries; they are never returned. */
const OPAQUE_ENQUEUED_AT = "0";
const INSERT_CHUNK = 50;

interface PlannedRow {
  id: string;
  enqueuedAt: string;
  payload: string;
  readable: 0 | 1;
}

async function setup(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `create table if not exists offline_queue_v1 (
       seq integer primary key autoincrement,
       queue text not null,
       owner_user_id text not null,
       id text not null,
       enqueued_at text not null,
       payload text not null,
       readable integer not null default 1,
       legacy integer not null default 0,
       unique (queue, id)
     );
     create index if not exists offline_queue_v1_owner on offline_queue_v1 (owner_user_id, queue, enqueued_at, seq);
     create table if not exists offline_queue_migration (
       queue text primary key,
       state text not null,
       entries integer not null,
       checksum text not null
     );`
  );
  for (const queue of Object.keys(LEGACY_QUEUE_KEYS) as QueueName[]) {
    await migrateQueue(db, queue);
  }
}

/** Queues whose old AsyncStorage list could not be moved this run; readers merge them in. Per open handle. */
const held = new WeakMap<object, Set<QueueName>>();

function heldFor(db: SQLite.SQLiteDatabase): Set<QueueName> {
  let s = held.get(db);
  if (!s) {
    s = new Set();
    held.set(db, s);
  }
  return s;
}

function isReadable(value: unknown): value is StoredEntry<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { enqueuedAt?: unknown }).enqueuedAt === "string" &&
    typeof (value as { item?: unknown }).item === "object" &&
    (value as { item?: unknown }).item !== null
  );
}

/** Turns the old JSON list into rows. Total: every element, readable or not, becomes exactly one row. */
export function planLegacyRows(queue: QueueName, raw: string): PlannedRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [{ id: `unreadable-${queue}-file`, enqueuedAt: OPAQUE_ENQUEUED_AT, payload: raw, readable: 0 }];
  }
  if (!Array.isArray(parsed)) {
    return [{ id: `unreadable-${queue}-file`, enqueuedAt: OPAQUE_ENQUEUED_AT, payload: raw, readable: 0 }];
  }
  const seen = new Set<string>();
  return parsed.map((el, index): PlannedRow => {
    if (!isReadable(el)) {
      return { id: `unreadable-${queue}-${index}`, enqueuedAt: OPAQUE_ENQUEUED_AT, payload: JSON.stringify(el ?? null), readable: 0 };
    }
    // The old list tolerated a repeated id (a remove deleted them all). Keep both entries; the server dedupes on its own key.
    let id = el.id;
    for (let n = 2; seen.has(id); n++) id = `${el.id}#${n}`;
    seen.add(id);
    return { id, enqueuedAt: el.enqueuedAt, payload: JSON.stringify(el.item ?? null), readable: 1 };
  });
}

export function checksumRows(rows: readonly PlannedRow[]): string {
  return rowsChecksum(rows.map((r) => [r.id, r.enqueuedAt, r.payload, r.readable]));
}

const LAST_OWNER_KEY = "@tarragon/offline-queue-owner/v1";
let lastOwner: string | null = null;

/**
 * The signed-in account. Offline with an expired token the auth client cannot refresh and answers "no session" WITH an
 * error; that is not a sign-out, and a reading taken then must still be queued (the old queue needed no session at
 * all). So an answer with a fetch error falls back to the last account seen with a live session (an id, no health data).
 * An answer without an error is a real sign-out: nobody is signed in and the queue shows nothing.
 */
async function sessionUserId(): Promise<string | null> {
  try {
    const { data, error } = (await supabase.auth.getSession()) as {
      data: { session: { user?: { id?: string } } | null };
      error?: { name?: string; message?: string } | null;
    };
    const id = data.session?.user?.id ?? null;
    if (id) {
      if (id !== lastOwner) {
        lastOwner = id;
        await AsyncStorage.setItem(LAST_OWNER_KEY, id).catch(() => {});
      }
      return id;
    }
    if (error && /retryable|fetch|network|timeout/i.test(`${error.name ?? ""} ${error.message ?? ""}`)) {
      if (lastOwner) return lastOwner;
      return (await AsyncStorage.getItem(LAST_OWNER_KEY).catch(() => null)) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Test hook. */
export function __resetQueueOwnerForTests(): void {
  lastOwner = null;
}

async function migrateQueue(db: SQLite.SQLiteDatabase, queue: QueueName): Promise<void> {
  const key = LEGACY_QUEUE_KEYS[queue];
  try {
    const state = await db.getFirstAsync<{ state: string }>("select state from offline_queue_migration where queue = ?", [queue]);
    if (state) {
      // Copied and verified on an earlier start. Never copy again; only finish removing the old list.
      if (state.state === "verified") await finishRemoval(db, queue, key);
      return;
    }
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) {
      await db.runAsync("insert into offline_queue_migration (queue, state, entries, checksum) values (?, 'done', 0, '')", [queue]);
      return;
    }
    const planned = planLegacyRows(queue, raw);
    const sourceChecksum = checksumRows(planned);
    const owner = (await sessionUserId()) ?? UNCLAIMED;
    // No transaction on the shared handle: other modules (the outbox) write on the same connection and would be rolled
    // back with it. Instead: clear any half copy from a crashed earlier attempt, insert in single statements, read back
    // and compare, and only a match writes the marker (the commit point). A mismatch deletes the copy again.
    await db.runAsync("delete from offline_queue_v1 where queue = ? and legacy = 1", [queue]);
    for (let i = 0; i < planned.length; i += INSERT_CHUNK) {
      const chunk = planned.slice(i, i + INSERT_CHUNK);
      await db.runAsync(
        `insert into offline_queue_v1 (queue, owner_user_id, id, enqueued_at, payload, readable, legacy) values ${chunk.map(() => "(?, ?, ?, ?, ?, ?, 1)").join(", ")}`,
        chunk.flatMap((r) => [queue, owner, r.id, r.enqueuedAt, r.payload, r.readable])
      );
    }
    const back = await db.getAllAsync<{ id: string; enqueued_at: string; payload: string; readable: number }>(
      "select id, enqueued_at, payload, readable from offline_queue_v1 where queue = ? and legacy = 1 order by seq",
      [queue]
    );
    const copied = back.map((r): PlannedRow => ({ id: r.id, enqueuedAt: r.enqueued_at, payload: r.payload, readable: r.readable === 1 ? 1 : 0 }));
    if (copied.length !== planned.length || checksumRows(copied) !== sourceChecksum) {
      await db.runAsync("delete from offline_queue_v1 where queue = ? and legacy = 1", [queue]);
      throw new Error(`offline queue ${queue}: ${planned.length} entries in the old list, ${copied.length} copied, or checksum differs`);
    }
    await db.runAsync("insert into offline_queue_migration (queue, state, entries, checksum) values (?, 'verified', ?, ?)", [
      queue,
      planned.length,
      sourceChecksum,
    ]);
    const opaque = planned.filter((r) => r.readable === 0).length;
    if (opaque > 0) recordSyncError("offline_outbox", `offline_queue:unreadable:${queue}`, `${opaque} entries could not be read; kept encrypted, not uploaded`);
    await finishRemoval(db, queue, key);
  } catch (error) {
    // The old list stays exactly where it is and readers keep using it. Retried at the next start.
    heldFor(db).add(queue);
    const code = eventCode(Crypto.randomUUID());
    recordSyncError("offline_outbox", `offline_queue:migrate:${queue}:${code}`, error);
    await addStoreNotice({ kind: "migration_held", code });
  }
}

async function finishRemoval(db: SQLite.SQLiteDatabase, queue: QueueName, key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
    await db.runAsync("update offline_queue_migration set state = 'done' where queue = ?", [queue]);
  } catch (error) {
    // Copy is verified; only the delete failed. The next start retries the delete and never copies again.
    recordSyncError("offline_outbox", `offline_queue:removeOld:${queue}`, error);
  }
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  return getStoreWithSchema("offline_queues", setup);
}

async function claimUnclaimed(db: SQLite.SQLiteDatabase, owner: string): Promise<void> {
  await db.runAsync("update offline_queue_v1 set owner_user_id = ? where owner_user_id = ?", [owner, UNCLAIMED]);
}

/** Readable entries of an old list that is still waiting to be moved (escape hatch). Never throws. */
async function legacyEntries<T>(queue: QueueName): Promise<StoredEntry<T>[]> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_QUEUE_KEYS[queue]);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(isReadable) as StoredEntry<T>[]) : [];
  } catch {
    return [];
  }
}

async function removeLegacyEntry(queue: QueueName, id: string): Promise<void> {
  const key = LEGACY_QUEUE_KEYS[queue];
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return;
  await AsyncStorage.setItem(key, JSON.stringify(parsed.filter((e) => !(isReadable(e) && e.id === id))));
}

export const MAX_QUEUE_SIZE = 500;

export async function listQueue<T>(queue: QueueName, source: SyncSource): Promise<StoredEntry<T>[]> {
  const owner = await sessionUserId();
  if (!owner) return [];
  try {
    const db = await getDb();
    await claimUnclaimed(db, owner);
    const rows = await db.getAllAsync<{ id: string; enqueued_at: string; payload: string }>(
      "select id, enqueued_at, payload from offline_queue_v1 where owner_user_id = ? and queue = ? and readable = 1 order by seq",
      [owner, queue]
    );
    const entries: StoredEntry<T>[] = [];
    for (const r of rows) {
      try {
        entries.push({ id: r.id, enqueuedAt: r.enqueued_at, item: JSON.parse(r.payload) as T });
      } catch (error) {
        recordSyncError(source, "offline_queue:read", error);
      }
    }
    if (heldFor(db).has(queue)) {
      const have = new Set(entries.map((e) => e.id));
      const old = (await legacyEntries<T>(queue)).filter((e) => !have.has(e.id));
      return [...old, ...entries];
    }
    return entries;
  } catch (error) {
    // The store could not be used (keychain locked, disk busy). An old list that has not been moved yet must still be
    // visible, or its readings would look synced when they are not. Entries already in the store show again next call.
    recordSyncError(source, "offline_queue:read", error);
    return legacyEntries<T>(queue);
  }
}

/** Returns whether the entry actually landed. Drop-oldest past MAX_QUEUE_SIZE per account and queue, recorded. */
export async function appendQueue<T>(queue: QueueName, item: T, source: SyncSource): Promise<boolean> {
  try {
    const owner = await sessionUserId();
    if (!owner) throw new Error("No signed-in account to queue this under");
    const db = await getDb();
    await claimUnclaimed(db, owner);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const enqueuedAt = new Date().toISOString();
    await db.runAsync(
      "insert into offline_queue_v1 (queue, owner_user_id, id, enqueued_at, payload, readable, legacy) values (?, ?, ?, ?, ?, 1, 0)",
      [queue, owner, id, enqueuedAt, JSON.stringify(item ?? null)]
    );
    // Oldest by insertion order (seq), never by clock: a phone clock that went backwards must not make the NEWEST reading look oldest.
    const count = await db.getFirstAsync<{ n: number }>(
      "select count(*) as n from offline_queue_v1 where owner_user_id = ? and queue = ? and readable = 1",
      [owner, queue]
    );
    const over = (count?.n ?? 0) - MAX_QUEUE_SIZE;
    if (over > 0) {
      await db.runAsync(
        "delete from offline_queue_v1 where seq in (select seq from offline_queue_v1 where owner_user_id = ? and queue = ? and readable = 1 order by seq limit ?)",
        [owner, queue, over]
      );
      recordSyncError(source, "offline_queue:overflow", `Queue full (${MAX_QUEUE_SIZE}); discarded ${over} oldest entr${over === 1 ? "y" : "ies"}.`);
    }
    return true;
  } catch (error) {
    recordSyncError(source, "offline_queue:write", error);
    return false;
  }
}

export async function removeFromQueueStore(queue: QueueName, id: string, source: SyncSource): Promise<void> {
  const owner = await sessionUserId();
  if (!owner) {
    recordSyncError(source, "offline_queue:remove", "No signed-in account; the sent entry stays queued and is re-sent (the server dedupes).");
    return;
  }
  try {
    const db = await getDb();
    await db.runAsync("delete from offline_queue_v1 where owner_user_id = ? and queue = ? and id = ?", [owner, queue, id]);
    if (heldFor(db).has(queue)) await removeLegacyEntry(queue, id);
  } catch (error) {
    recordSyncError(source, "offline_queue:write", error);
    // The store was unusable, so the entry may be one that is still in the old list.
    await removeLegacyEntry(queue, id).catch(() => {});
  }
}

export interface QueuedByOwner {
  owner: string;
  total: number;
}

/**
 * Counts of waiting queue entries for every account on the phone (counts only). Used by the remote wipe. Old
 * AsyncStorage lists that have not been moved yet count too, under the unclaimed owner "" (the wipe removes them).
 */
export async function countQueuedByOwner(): Promise<QueuedByOwner[]> {
  const out = new Map<string, number>();
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<{ owner_user_id: string; n: number }>(
      "select owner_user_id, count(*) as n from offline_queue_v1 where readable = 1 group by owner_user_id"
    );
    for (const r of rows) out.set(r.owner_user_id, r.n);
  } catch (error) {
    recordSyncError("offline_outbox", "offline_queue:count", error);
  }
  let unmoved = 0;
  for (const queue of Object.keys(LEGACY_QUEUE_KEYS) as QueueName[]) unmoved += (await legacyEntries(queue)).length;
  if (unmoved > 0) out.set(UNCLAIMED, (out.get(UNCLAIMED) ?? 0) + unmoved);
  return [...out].map(([owner, total]) => ({ owner, total }));
}

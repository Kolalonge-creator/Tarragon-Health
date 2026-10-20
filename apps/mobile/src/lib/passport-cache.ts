import type * as SQLite from "expo-sqlite";
import { getStoreWithSchema } from "./secure-db";
import { supabase } from "./supabase";
import { classifyFailure } from "./outbox-rules";
import { recordSyncError } from "./sync-diagnostics";

/**
 * Last good copy of the Passport read screens (S43m): health history, symptom journal, results over time, documents list, sharing settings.
 *
 * Why it exists: a person in a clinic with no signal should still be able to open their own record. Why it is small: it holds only what
 * the person is allowed to read anyway, in the same encrypted store as the S06 mirror, scoped to the signed-in account, and wiped at
 * sign-out and by a remote wipe (the store itself is removed). It never holds a share link, a PIN, a photo or a document's extracted
 * text, and a failed read never overwrites a good copy.
 *
 * Every call takes the account that was signed in when the read BEGAN (`owner`), so a read that finishes after a sign-out and a different
 * sign-in can neither store, serve nor delete anything under the new account.
 */

async function setup(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `create table if not exists passport_cache (
      owner_user_id text not null,
      key text not null,
      body text not null,
      saved_at text not null,
      primary key (owner_user_id, key)
    );`
  );
}

const db = () => getStoreWithSchema("passport_cache", setup);

async function currentUserId(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export interface CachedCopy<T> {
  value: T;
  savedAt: string;
}

let prunedFor: string | null = null;

/**
 * Rows of any other account are removed the first time an account opens the cache. The sign-out wipe is the main guard, but it can fail
 * (a busy store) or never run (a session revoked while the app was closed), and a phone is often shared. Best effort: a failure here must
 * never make the person's own copy unreadable.
 */
async function pruneOtherOwners(owner: string): Promise<void> {
  if (prunedFor === owner) return;
  try {
    await (await db()).runAsync("delete from passport_cache where owner_user_id <> ?", [owner]);
    prunedFor = owner;
  } catch (error) {
    recordSyncError("offline_outbox", "passportCachePrune", error);
  }
}

/** Test hook. */
export function __resetPassportCacheForTests(): void {
  prunedFor = null;
}

/** The signed-in account, or null when nobody is, or when it is not the account the caller started with. */
async function ownerIfStillSignedIn(expected?: string): Promise<string | null> {
  const owner = await currentUserId();
  if (!owner || (expected !== undefined && expected !== owner)) return null;
  return owner;
}

/** Best effort: a store that will not open never stops a screen from showing what it just read. */
export async function cacheWrite(key: string, value: unknown, expectedOwner?: string): Promise<void> {
  try {
    const owner = await ownerIfStillSignedIn(expectedOwner);
    if (!owner) return;
    await pruneOtherOwners(owner);
    await (await db()).runAsync("insert or replace into passport_cache (owner_user_id, key, body, saved_at) values (?, ?, ?, ?)", [
      owner,
      key,
      JSON.stringify(value),
      new Date().toISOString(),
    ]);
  } catch (error) {
    recordSyncError("offline_outbox", "passportCacheWrite", error);
  }
}

export async function cacheRead<T>(key: string, expectedOwner?: string): Promise<CachedCopy<T> | null> {
  try {
    const owner = await ownerIfStillSignedIn(expectedOwner);
    if (!owner) return null;
    await pruneOtherOwners(owner);
    const row = await (await db()).getFirstAsync<{ body: string; saved_at: string }>(
      "select body, saved_at from passport_cache where owner_user_id = ? and key = ?",
      [owner, key]
    );
    if (!row) return null;
    return { value: JSON.parse(row.body) as T, savedAt: row.saved_at };
  } catch {
    return null;
  }
}

export async function cacheDelete(key: string, expectedOwner?: string): Promise<void> {
  try {
    const owner = await ownerIfStillSignedIn(expectedOwner);
    if (!owner) return;
    await (await db()).runAsync("delete from passport_cache where owner_user_id = ? and key = ?", [owner, key]);
  } catch (error) {
    recordSyncError("offline_outbox", "passportCacheDelete", error);
  }
}

/** Sign-out: nothing of the previous account stays readable on a shared phone. */
export async function clearPassportCache(): Promise<void> {
  await (await db()).execAsync("delete from passport_cache;");
}

export type FetchOutcome<T> = { ok: true; data: T } | { ok: false; error: { code?: string; message?: string } };

export type ReadResult<T> =
  | { ok: true; data: T; stale: false }
  /** A copy from an earlier visit, shown because the live read failed. `offline` says whether that was a lost connection. */
  | { ok: true; data: T; stale: true; savedAt: string; offline: boolean }
  /** `refused`: the database said no (access withdrawn or never given). Callers must not fall back to any other saved source either. */
  | { ok: false; offline: boolean; refused: boolean };

export function isOffline(error: { code?: string; message?: string }): boolean {
  return classifyFailure({ code: error.code, message: error.message }) === "network";
}

export interface ReadOptions {
  /**
   * False for anything that is not the signed-in person's own record (a supporter looking at someone they support): it is read live and
   * never kept on this phone, because the other person can withdraw access and a saved copy would outlive it.
   */
  keep?: boolean;
}

/**
 * Live read first. On success the copy is refreshed; on a lost connection, a server error or an expired sign-in the last copy is shown and
 * marked stale, so the screen can say so. A REFUSAL (the database said no) never falls back: the copy is deleted and the failure reported
 * with `refused`, so access that was withdrawn does not keep showing the old record. With no copy the failure is reported as it is (offline
 * or another error), never as an empty list that would read as "nothing here".
 */
export async function readThrough<T>(key: string, fetcher: () => Promise<FetchOutcome<T>>, options: ReadOptions = {}): Promise<ReadResult<T>> {
  const keep = options.keep !== false;
  const owner = keep ? ((await currentUserId()) ?? undefined) : undefined;
  let outcome: FetchOutcome<T>;
  try {
    outcome = await fetcher();
  } catch (e) {
    outcome = { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
  }
  if (outcome.ok) {
    if (keep && owner) await cacheWrite(key, outcome.data, owner);
    return { ok: true, data: outcome.data, stale: false };
  }
  const failure = classifyFailure({ code: outcome.error.code, message: outcome.error.message });
  const offline = failure === "network";
  if (failure === "rejected") {
    if (keep && owner) await cacheDelete(key, owner);
    return { ok: false, offline: false, refused: true };
  }
  const copy = keep && owner ? await cacheRead<T>(key, owner) : null;
  if (copy) return { ok: true, data: copy.value, stale: true, savedAt: copy.savedAt, offline };
  return { ok: false, offline, refused: false };
}

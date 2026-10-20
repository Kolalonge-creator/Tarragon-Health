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

/** Best effort: a store that will not open never stops a screen from showing what it just read. */
export async function cacheWrite(key: string, value: unknown): Promise<void> {
  try {
    const owner = await currentUserId();
    if (!owner) return;
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

export async function cacheRead<T>(key: string): Promise<CachedCopy<T> | null> {
  try {
    const owner = await currentUserId();
    if (!owner) return null;
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

/** Sign-out: nothing of the previous account stays readable on a shared phone. */
export async function clearPassportCache(): Promise<void> {
  await (await db()).execAsync("delete from passport_cache;");
}

export type FetchOutcome<T> = { ok: true; data: T } | { ok: false; error: { code?: string; message?: string } };

export type ReadResult<T> =
  | { ok: true; data: T; stale: false }
  /** A copy from an earlier visit, shown because the live read failed. `offline` says whether that was a lost connection. */
  | { ok: true; data: T; stale: true; savedAt: string; offline: boolean }
  | { ok: false; offline: boolean };

export function isOffline(error: { code?: string; message?: string }): boolean {
  return classifyFailure({ code: error.code, message: error.message }) === "network";
}

/**
 * Live read first. On success the copy is refreshed; on failure the last copy is shown and marked stale, so the screen can say so.
 * With no copy the failure is reported as it is (offline or another error), never as an empty list that would read as "nothing here".
 */
export async function readThrough<T>(key: string, fetcher: () => Promise<FetchOutcome<T>>): Promise<ReadResult<T>> {
  let outcome: FetchOutcome<T>;
  try {
    outcome = await fetcher();
  } catch (e) {
    outcome = { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
  }
  if (outcome.ok) {
    await cacheWrite(key, outcome.data);
    return { ok: true, data: outcome.data, stale: false };
  }
  const offline = isOffline(outcome.error);
  const copy = await cacheRead<T>(key);
  if (copy) return { ok: true, data: copy.value, stale: true, savedAt: copy.savedAt, offline };
  return { ok: false, offline };
}

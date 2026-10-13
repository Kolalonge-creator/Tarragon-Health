import type * as SQLite from "expo-sqlite";
import { getStoreWithSchema } from "./secure-db";
import { supabase } from "./supabase";

/**
 * Form drafts saved on every change (spec section 11, power-cut resilience): if
 * the phone dies or the app is killed mid-entry, the half-typed form comes
 * back. Same encrypted on-device database as the outbox. A draft holds only what
 * the patient typed, is removed once the entry is safely queued, and is never
 * sent anywhere.
 *
 * S06x (decision D2): a draft belongs to the account that typed it. Signing out,
 * including a forced sign-out when a session expires, does NOT delete it: it waits,
 * encrypted, and comes back when that same account signs in again. Another account
 * on the same phone cannot read it (every query is scoped to the signed-in
 * account). Only the read mirror is wiped at sign-out. A remote wipe or a store
 * reset removes the whole file, drafts included.
 */
async function setupDrafts(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `create table if not exists drafts_v2 (
       owner_user_id text not null,
       key text not null,
       value text not null,
       updated_at text not null,
       primary key (owner_user_id, key)
     );
     drop table if exists drafts;`
  );
  // The pre-S06x drafts table had no account on its rows, so nobody can be shown them safely (typed form text only).
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  return getStoreWithSchema("drafts", setupDrafts);
}

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

/** Never throws: a failed draft save must not get in the way of typing. */
export async function saveDraft(key: string, value: unknown): Promise<void> {
  try {
    const owner = await currentUserId();
    if (!owner) return;
    const db = await getDb();
    await db.runAsync("insert or replace into drafts_v2 (owner_user_id, key, value, updated_at) values (?, ?, ?, ?)", [
      owner,
      key,
      JSON.stringify(value),
      new Date().toISOString(),
    ]);
  } catch {
    // best effort
  }
}

export async function loadDraft<T>(key: string): Promise<T | null> {
  try {
    const owner = await currentUserId();
    if (!owner) return null;
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>("select value from drafts_v2 where owner_user_id = ? and key = ?", [owner, key]);
    return row ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    const owner = await currentUserId();
    if (!owner) return;
    const db = await getDb();
    await db.runAsync("delete from drafts_v2 where owner_user_id = ? and key = ?", [owner, key]);
  } catch {
    // best effort
  }
}

/** The signed-in account's drafts only. Not called at sign-out (D2); for an explicit "clear my drafts". */
export async function clearAllDrafts(): Promise<void> {
  try {
    const owner = await currentUserId();
    if (!owner) return;
    const db = await getDb();
    await db.runAsync("delete from drafts_v2 where owner_user_id = ?", [owner]);
  } catch {
    // best effort
  }
}

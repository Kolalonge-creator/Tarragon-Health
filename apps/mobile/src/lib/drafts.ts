import * as SQLite from "expo-sqlite";

/**
 * Form drafts saved on every change (spec section 11, power-cut resilience): if
 * the phone dies or the app is killed mid-entry, the half-typed form comes
 * back. Same on-device database as the outbox. A draft holds only what the
 * patient typed, is removed once the entry is safely queued, and is never sent
 * anywhere.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("tarragon-offline.db").then(async (db) => {
      await db.execAsync(
        "create table if not exists drafts (key text primary key, value text not null, updated_at text not null);"
      );
      return db;
    });
  }
  return dbPromise;
}

/** Never throws: a failed draft save must not get in the way of typing. */
export async function saveDraft(key: string, value: unknown): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync("insert or replace into drafts (key, value, updated_at) values (?, ?, ?)", [
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
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>("select value from drafts where key = ?", [key]);
    return row ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync("delete from drafts where key = ?", [key]);
  } catch {
    // best effort
  }
}

/** Drafts are typed text, not a record: wipe them on sign-out with the mirror. */
export async function clearAllDrafts(): Promise<void> {
  try {
    const db = await getDb();
    await db.execAsync("delete from drafts;");
  } catch {
    // best effort
  }
}

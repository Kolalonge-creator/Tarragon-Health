import * as SQLite from "expo-sqlite";
import { offlineSyncPlan, offlineVisible, reviewExpired } from "@tarragon/shared";

/**
 * Learning Centre downloads (S55, 9.6): topics saved on the phone to read with no signal. Uses the same SQLite file as the
 * offline store (tarragon-offline.db), in its own table.
 *
 * Safety rule: a saved topic must never outlive its review date. Two guards: every read hides and deletes an item whose
 * next_review_due has passed (works with no signal), and `syncDownloads` asks the server which saved codes may still be served
 * and deletes the rest (expired, withdrawn, or locked for this person). A Members item is never saved for a non-member
 * (`locked` items carry no body, and are refused here).
 */

export interface DownloadableItem {
  content_id: string;
  code: string;
  title: string;
  summary: string | null;
  body: string | null;
  content_type: string;
  estimated_minutes: number | null;
  category: string;
  clinician_reviewed?: boolean | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  source_reference?: string | null;
  next_review_due?: string | null;
  next_action?: string | null;
  next_step_kind?: string | null;
  next_step_target_code?: string | null;
  next_step_target_title?: string | null;
  creator_name?: string | null;
  locked?: boolean | null;
  /** The server's content version when this copy was saved. A different version later means the text was corrected: the copy is deleted. */
  content_version?: number | null;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("tarragon-offline.db").then(async (db) => {
      await db.execAsync(
        `create table if not exists local_learning (
          owner_user_id text not null,
          code text not null,
          row text not null,
          next_review_due text,
          saved_at text not null,
          primary key (owner_user_id, code)
        );`
      );
      return db;
    });
  }
  return dbPromise;
}

interface StoredRow {
  code: string;
  row: string;
  next_review_due: string | null;
}

export type SaveResult = { ok: true } | { ok: false; reason: "locked" | "expired" | "empty" };

export async function saveDownload(owner: string, item: DownloadableItem, now: Date = new Date()): Promise<SaveResult> {
  if (item.locked) return { ok: false, reason: "locked" };
  if (!item.body) return { ok: false, reason: "empty" };
  if (reviewExpired(item.next_review_due, now)) return { ok: false, reason: "expired" };
  const db = await getDb();
  await db.runAsync("insert or replace into local_learning (owner_user_id, code, row, next_review_due, saved_at) values (?, ?, ?, ?, ?)", [
    owner,
    item.code,
    JSON.stringify(item),
    item.next_review_due ?? null,
    now.toISOString(),
  ]);
  return { ok: true };
}

export async function removeDownload(owner: string, code: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("delete from local_learning where owner_user_id = ? and code = ?", [owner, code]);
}

export async function isDownloaded(owner: string, code: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ code: string }>("select code from local_learning where owner_user_id = ? and code = ?", [owner, code]);
  return row !== null;
}

/** Deletes every saved topic whose review date has passed (no network needed). Returns how many were removed. */
export async function purgeExpiredDownloads(owner: string, now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<StoredRow>("select code, row, next_review_due from local_learning where owner_user_id = ?", [owner]);
  const stale = rows.filter((r) => reviewExpired(r.next_review_due, now));
  for (const r of stale) await removeDownload(owner, r.code);
  return stale.length;
}

/** The saved topics for the Downloads screen. Expired ones are hidden (and deleted) first. */
export async function listDownloads(owner: string, now: Date = new Date()): Promise<DownloadableItem[]> {
  await purgeExpiredDownloads(owner, now);
  const db = await getDb();
  const rows = await db.getAllAsync<StoredRow>(
    "select code, row, next_review_due from local_learning where owner_user_id = ? order by saved_at desc",
    [owner]
  );
  return offlineVisible(
    rows.map((r) => ({ ...(JSON.parse(r.row) as DownloadableItem), next_review_due: r.next_review_due })),
    now
  );
}

export interface SyncResult {
  removed: number;
  kept: number;
  /** True when the server could not be reached: only the local review-date rule was applied. */
  offline: boolean;
}

/**
 * Re-check on sync. `fetchServable` returns the codes (with their current review date) the server will still serve for this
 * person, or null when it cannot be reached. A saved topic missing from the answer is deleted.
 */
export async function syncDownloads(
  owner: string,
  fetchServable: (codes: string[]) => Promise<{ code: string; next_review_due: string | null; content_version?: number | null }[] | null>,
  now: Date = new Date()
): Promise<SyncResult> {
  const localRemoved = await purgeExpiredDownloads(owner, now);
  const db = await getDb();
  const rows = await db.getAllAsync<StoredRow>("select code, row, next_review_due from local_learning where owner_user_id = ?", [owner]);
  if (rows.length === 0) return { removed: localRemoved, kept: 0, offline: false };
  const servable = await fetchServable(rows.map((r) => r.code));
  if (servable === null) return { removed: localRemoved, kept: rows.length, offline: true };
  const plan = offlineSyncPlan(rows, servable);
  for (const r of plan.drop) await removeDownload(owner, r.code);
  // A corrected item (a new content version) is deleted too: a stale copy of clinical text must not outlive its correction.
  let outdated = 0;
  const current = new Set<string>();
  for (const r of plan.keep) {
    const saved = (JSON.parse(r.row) as DownloadableItem).content_version ?? null;
    const now = servable.find((s) => s.code === r.code)?.content_version ?? null;
    if (saved !== null && now !== null && saved !== now) {
      await removeDownload(owner, r.code);
      outdated += 1;
    } else {
      current.add(r.code);
    }
  }
  for (const s of servable.filter((x) => current.has(x.code))) {
    await db.runAsync("update local_learning set next_review_due = ? where owner_user_id = ? and code = ?", [s.next_review_due ?? null, owner, s.code]);
  }
  return { removed: localRemoved + plan.drop.length + outdated, kept: plan.keep.length - outdated, offline: false };
}

import type * as SQLite from "expo-sqlite";
import { getStoreWithSchema } from "./secure-db";
import { supabase } from "./supabase";
import { signedReports, type SignedReportRow } from "./health-report-view";

/**
 * Loads the person's signed yearly reports and keeps a copy on the phone so they can be read with no signal (S46d). The copy lives in the encrypted phone
 * store (secure-db), not in plain storage. Only signed reports are ever fetched into view or saved (see health-report-view.ts).
 */

export interface ReportCache {
  read(userId: string): Promise<{ payload: string; cachedAt: string } | null>;
  write(userId: string, payload: string, cachedAt: string): Promise<void>;
  clear(userId: string): Promise<void>;
}

export type ReportsLoad =
  | { kind: "fresh"; reports: SignedReportRow[] }
  | { kind: "cached"; reports: SignedReportRow[]; cachedAt: string }
  | { kind: "empty" }
  | { kind: "error" };

/**
 * `fetchRows` returns the raw rows, or null when the read failed (offline, a server error). A failed read falls back to the saved copy; a successful read
 * with no signed report clears the copy (a report that is no longer signed must not stay readable). A saved copy is trusted only after the same
 * signed-report check, so a damaged or hand-edited copy shows nothing.
 */
export async function loadSignedReports(deps: { userId: string; fetchRows: () => Promise<unknown[] | null>; cache: ReportCache; now?: () => Date }): Promise<ReportsLoad> {
  const now = deps.now ?? (() => new Date());
  let rows: unknown[] | null = null;
  try {
    rows = await deps.fetchRows();
  } catch {
    rows = null;
  }
  if (rows !== null) {
    const reports = signedReports(rows);
    try {
      if (reports.length === 0) await deps.cache.clear(deps.userId);
      else await deps.cache.write(deps.userId, JSON.stringify(reports), now().toISOString());
    } catch {
      // a failed save never hides a report we already have in hand
    }
    return reports.length === 0 ? { kind: "empty" } : { kind: "fresh", reports };
  }
  try {
    const saved = await deps.cache.read(deps.userId);
    if (saved) {
      const reports = signedReports(JSON.parse(saved.payload) as unknown);
      if (reports.length > 0) return { kind: "cached", reports, cachedAt: saved.cachedAt };
    }
  } catch {
    // an unreadable copy is the same as no copy
  }
  return { kind: "error" };
}

async function setup(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync("create table if not exists health_report_cache (user_id text primary key, payload text not null, cached_at text not null);");
}

const phoneCache: ReportCache = {
  async read(userId) {
    const db = await getStoreWithSchema("health_report", setup);
    const row = await db.getFirstAsync<{ payload: string; cached_at: string }>("select payload, cached_at from health_report_cache where user_id = ?", [userId]);
    return row ? { payload: row.payload, cachedAt: row.cached_at } : null;
  },
  async write(userId, payload, cachedAt) {
    const db = await getStoreWithSchema("health_report", setup);
    await db.runAsync("insert or replace into health_report_cache (user_id, payload, cached_at) values (?, ?, ?)", [userId, payload, cachedAt]);
  },
  async clear(userId) {
    const db = await getStoreWithSchema("health_report", setup);
    await db.runAsync("delete from health_report_cache where user_id = ?", [userId]);
  },
};

/** Removes every saved report from the phone (called with the read mirror's wipe on sign-out, so a shared phone keeps nothing of the last account). */
export async function clearAllHealthReportCache(): Promise<void> {
  const db = await getStoreWithSchema("health_report", setup);
  await db.runAsync("delete from health_report_cache");
}

/** The signed-in person's own signed reports. Row level security returns nothing that is not signed; the check in health-report-view.ts runs as well. */
export async function loadMyHealthReports(): Promise<ReportsLoad> {
  let userId: string | null = null;
  try {
    userId = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return { kind: "error" };
  return loadSignedReports({
    userId,
    cache: phoneCache,
    fetchRows: async () => {
      const { data, error } = await supabase
        .from("health_reports")
        .select("id, year, version, status, summary_text, signer_name, signer_registration, signed_at, correction_note, composed")
        .order("year", { ascending: false })
        .order("version", { ascending: false });
      return error ? null : (data as unknown[] | null) ?? [];
    },
  });
}

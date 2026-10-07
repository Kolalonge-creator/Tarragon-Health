/**
 * Read side of the S39c/S39d review screens: who opened which patient records, and what the retention review sees.
 * The functions and tables are admin / CMO only in the database (`private.can_review_access_log`); a refusal comes back as an error and is shown
 * as such, never as an empty list.
 */
interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(cols: string): {
      order(col: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
  };
}

export interface AccessReviewRow {
  staff_id: string;
  staff_name: string;
  openings: number;
  untied_openings: number;
  after_hours_openings: number;
  distinct_patients: number;
}
export interface RetentionRow { table_name: string; retention_class: string; period: string; rows_older_than_period: number; reviewed: boolean }
export interface RecentOpen { id: string; opened_at: string; staff_id: string; patient_id: string; basis: string; after_hours: boolean }
export type Loaded<T> = { ok: true; rows: T[] } | { ok: false; message: string };

async function rpcRows<T>(client: unknown, fn: string, args?: Record<string, unknown>): Promise<Loaded<T>> {
  const { data, error } = await (client as Rpc).rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  return { ok: true, rows: Array.isArray(data) ? (data as T[]) : [] };
}

export const loadAccessReview = (client: unknown, days = 7) => rpcRows<AccessReviewRow>(client, "access_review_report", { p_days: days });
export const loadRetentionReport = (client: unknown) => rpcRows<RetentionRow>(client, "retention_review_report");

export async function loadRecentOpens(client: unknown, limit = 50): Promise<Loaded<RecentOpen>> {
  const { data, error } = await (client as Rpc).from("staff_record_opens").select("id, opened_at, staff_id, patient_id, basis, after_hours").order("opened_at", { ascending: false }).limit(limit);
  if (error) return { ok: false, message: error.message };
  return { ok: true, rows: Array.isArray(data) ? (data as RecentOpen[]) : [] };
}

/** Only classes with something to look at, most rows first. The report never deletes anything. */
export function dueForReview(rows: RetentionRow[]): RetentionRow[] {
  return rows.filter((r) => r.rows_older_than_period > 0).sort((a, b) => b.rows_older_than_period - a.rows_older_than_period);
}

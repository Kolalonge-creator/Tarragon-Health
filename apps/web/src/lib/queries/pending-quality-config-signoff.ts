import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type PendingQualityConfigSignoff = {
  /** An unsigned, inactive quality_config version newer than the one in force (S20 v2 sampling, second review, speak-up check-ins). */
  qualityVersion: number | null;
  /** An unsigned, inactive credentialing_config version newer than the one in force (S20 v2 licence notices and missing-date rule). */
  credentialingVersion: number | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

/** The newest draft that is not live, not signed and newer than the live version, or null. */
export function newestWaiting(rows: Row[]): number | null {
  const live = Math.max(0, ...rows.filter((r) => r.is_active).map((r) => r.version));
  const waiting = rows.filter((r) => !r.is_active && r.approved_at === null && r.version > live).map((r) => r.version);
  return waiting.length === 0 ? null : Math.max(...waiting);
}

/**
 * What the S20 v2 configurations need from the Chief Medical Officer, for the sign-off hub and the banner. Nothing signs by itself: these are
 * drafts that stay inactive until the CMO presses the sign control. Never throws; a failed read says so.
 */
export async function readPendingQualityConfigSignoff(supabase: SupabaseClient<Database>): Promise<PendingQualityConfigSignoff> {
  try {
    const loose = supabase as unknown as Loose;
    const [q, c] = await Promise.all([
      loose.from("quality_config").select("version, is_active, approved_at"),
      loose.from("credentialing_config").select("version, is_active, approved_at"),
    ]);
    if (q.error || c.error || !q.data || !c.data) return { qualityVersion: null, credentialingVersion: null, failed: true };
    return { qualityVersion: newestWaiting(q.data), credentialingVersion: newestWaiting(c.data), failed: false };
  } catch {
    return { qualityVersion: null, credentialingVersion: null, failed: true };
  }
}

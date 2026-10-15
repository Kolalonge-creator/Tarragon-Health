import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

export type PendingCapacityConfigSignoff = {
  /** An unsigned, inactive capacity_cover_config version newer than the one in force (intake gate, hard rest rule, fire drills). */
  capacityVersion: number | null;
  /** An unsigned, inactive lead_config version newer than the one in force (the pilot cap of 40 lead patients). */
  leadVersion: number | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

/**
 * What the capacity and cover configurations need from the Chief Medical Officer, for the sign-off hub. Nothing signs by itself: these are
 * drafts that stay inactive until the CMO presses the sign control. Never throws; a failed read says so.
 */
export async function readPendingCapacityConfigSignoff(supabase: SupabaseClient<Database>): Promise<PendingCapacityConfigSignoff> {
  try {
    const loose = supabase as unknown as Loose;
    const [c, l] = await Promise.all([
      loose.from("capacity_cover_config").select("version, is_active, approved_at"),
      loose.from("lead_config").select("version, is_active, approved_at"),
    ]);
    if (c.error || l.error || !c.data || !l.data) return { capacityVersion: null, leadVersion: null, failed: true };
    return { capacityVersion: newestWaiting(c.data), leadVersion: newestWaiting(l.data), failed: false };
  } catch {
    return { capacityVersion: null, leadVersion: null, failed: true };
  }
}

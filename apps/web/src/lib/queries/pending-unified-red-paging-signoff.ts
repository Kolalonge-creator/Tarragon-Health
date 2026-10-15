import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type UnifiedRedPagingState = {
  /** The newest version that is not live and newer than the live one (never switched on, or switched off earlier). Null when there is nothing to switch on. */
  waitingVersion: number | null;
  /** The live version, when unified red-event paging is ON. Null when it is OFF. */
  liveVersion: number | null;
  /** The read failed: never render this as an all-clear and never as "off". */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

/** Pure: the state of the config rows. A version waits when it is not live; the live one (if any) is the one in force. */
export function unifiedRedPagingState(rows: Row[]): { waitingVersion: number | null; liveVersion: number | null } {
  const live = rows.filter((r) => r.is_active).map((r) => r.version);
  const liveVersion = live.length === 0 ? null : Math.max(...live);
  // A version waits when it is not live and is newer than the live one (a newer version can replace the live one in one step); with nothing live, any inactive version waits.
  const waiting = rows.filter((r) => !r.is_active && (liveVersion === null || r.version > liveVersion)).map((r) => r.version);
  return { waitingVersion: waiting.length === 0 ? null : Math.max(...waiting), liveVersion };
}

/**
 * What unified red-event paging needs from the Chief Medical Officer, for the sign-off hub. Nothing switches on by itself: the version stays
 * inactive until the CMO presses the control after confirming the staging test pack. Never throws; a failed read says so.
 */
export async function readUnifiedRedPagingState(supabase: SupabaseClient<Database>): Promise<UnifiedRedPagingState> {
  try {
    const loose = supabase as unknown as Loose;
    const { data, error } = await loose.from("unified_red_paging_config").select("version, is_active, approved_at");
    if (error || !data) return { waitingVersion: null, liveVersion: null, failed: true };
    return { ...unifiedRedPagingState(data), failed: false };
  } catch {
    return { waitingVersion: null, liveVersion: null, failed: true };
  }
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** The go-live guard and condition the Stage 2 launch attestation is recorded against (the condition is not read from data; a person attests it). */
export const STAGE2_GUARD = "public_signup_enabled";
export const STAGE2_CODE = "stage2_exit_criteria_met";
export const STAGE2_ITEM_KEY = "stage2_launch_attestation";

export type PendingStage2Attestation = {
  /** No attestation is on record, or the latest one withdrew it. */
  waiting: boolean;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Loose = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          order(column: string, opts: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: { met: boolean }[] | null; error: unknown }> };
        };
      };
    };
  };
};

/**
 * Whether the Stage 2 exit criteria still await the founder's or Chief Medical Officer's attestation. The latest row for the guard and condition
 * decides (a later met = false withdraws an earlier one), the same rule as private.go_live_attested. Never throws; a failed read says so.
 */
export async function readPendingStage2Attestation(supabase: SupabaseClient<Database>): Promise<PendingStage2Attestation> {
  try {
    const { data, error } = await (supabase as unknown as Loose)
      .from("go_live_attestations")
      .select("met")
      .eq("guard_key", STAGE2_GUARD)
      .eq("condition_code", STAGE2_CODE)
      .order("id", { ascending: false })
      .limit(1);
    if (error || !data) return { waiting: false, failed: true };
    return { waiting: data[0]?.met !== true, failed: false };
  } catch {
    return { waiting: false, failed: true };
  }
}

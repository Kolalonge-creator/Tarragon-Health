import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { guardListSchema } from "@/lib/go-live/model";

/** The hub line key, and the go-live guard and condition that carry the Chief Medical Officer's signature on the fast-sugar wording (OQ-326). */
export const FAST_SUGAR_ITEM_KEY = "glucose_fast_sugar_wording";
export const FAST_SUGAR_GUARD = "glucose_fast_sugar_wording";
export const FAST_SUGAR_CONDITION = "fast_sugar_wording_signed";

export type PendingFastSugarWordingSignoff = {
  /** The guard exists and the signature has not been recorded. */
  waiting: boolean;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type RpcClient = { rpc(fn: string): PromiseLike<{ data: unknown; error: { message: string } | null }> };

/**
 * Whether the fast-sugar treatment wording still awaits the Chief Medical Officer's own signature (OQ-326). It is a line of its own, apart from the glucose
 * rules, because the wording is a clinical message and the rules are thresholds: signing one does not sign the other. Never throws; a failed read says so.
 * A guard that does not exist yet (the migration is not applied) is not a line and not a failure.
 */
export async function readPendingFastSugarWordingSignoff(supabase: SupabaseClient<Database>): Promise<PendingFastSugarWordingSignoff> {
  try {
    const { data, error } = await (supabase as unknown as RpcClient).rpc("go_live_guard_status");
    if (error) return { waiting: false, failed: true };
    const guards = guardListSchema.safeParse(data);
    if (!guards.success) return { waiting: false, failed: true };
    const guard = guards.data.find((g) => g.key === FAST_SUGAR_GUARD);
    if (!guard) return { waiting: false, failed: false };
    const condition = guard.conditions.find((c) => c.code === FAST_SUGAR_CONDITION);
    if (!condition) return { waiting: false, failed: true };
    return { waiting: !condition.met, failed: false };
  } catch {
    return { waiting: false, failed: true };
  }
}

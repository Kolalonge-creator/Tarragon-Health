import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const GLUCOSE_REVIEW_TASK_TYPE = "amber_glucose_review";

export type PendingGlucoseTaskTypeSignoff = {
  /** The urgent glucose review task type exists and the Chief Medical Officer has not confirmed it. */
  waiting: boolean;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

/**
 * Whether the urgent glucose review task type (R2, CMO Q7 and Q8) still awaits the Chief Medical Officer. Until it is confirmed no glucose rule set can be
 * signed (approve_triage_rule_set refuses), so this is its own hub line with its own confirm control. Never throws; a failed read says so.
 */
export async function readPendingGlucoseTaskTypeSignoff(supabase: SupabaseClient<Database>): Promise<PendingGlucoseTaskTypeSignoff> {
  try {
    const loose = supabase as unknown as {
      from(table: string): {
        select(columns: string): {
          eq(column: string, value: string | boolean): {
            eq(column: string, value: string | boolean): PromiseLike<{ data: Array<{ needs_confirmation: boolean; confirmed_at: string | null }> | null; error: unknown }>;
          };
        };
      };
    };
    const { data, error } = await loose.from("task_types").select("needs_confirmation, confirmed_at").eq("code", GLUCOSE_REVIEW_TASK_TYPE).eq("is_active", true);
    if (error || !data) return { waiting: false, failed: true };
    return { waiting: data.some((r) => r.needs_confirmation && !r.confirmed_at), failed: false };
  } catch {
    return { waiting: false, failed: true };
  }
}

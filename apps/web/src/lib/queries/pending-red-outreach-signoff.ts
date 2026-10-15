import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const RED_OUTREACH_TASK_TYPE = "red_patient_outreach";

export type PendingRedOutreachSignoff = {
  /** The call-the-patient task type exists and the Chief Medical Officer has not confirmed it, so no outreach task is created yet. */
  waiting: boolean;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

/**
 * Whether the red-alert outreach task type (S13 R4, CMO Q11) still awaits the Chief Medical Officer. Until it is confirmed the
 * 30 minute timer runs and the patient is told, but no clinician task is created. Same rule as the other hub sources: it never
 * throws, and a failed read says so.
 */
export async function readPendingRedOutreachSignoff(supabase: SupabaseClient<Database>): Promise<PendingRedOutreachSignoff> {
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
    const { data, error } = await loose.from("task_types").select("needs_confirmation, confirmed_at").eq("code", RED_OUTREACH_TASK_TYPE).eq("is_active", true);
    if (error || !data) return { waiting: false, failed: true };
    return { waiting: data.some((r) => r.needs_confirmation && !r.confirmed_at), failed: false };
  } catch {
    return { waiting: false, failed: true };
  }
}

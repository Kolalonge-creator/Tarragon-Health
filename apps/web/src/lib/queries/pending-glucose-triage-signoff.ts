import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** The hub line key for the glucose triage rule set draft (plan item R2). */
export const GLUCOSE_TRIAGE_ITEM_KEY = "glucose_triage_rule_set";

export type PendingGlucoseTriageSignoff = {
  /** A draft glucose_care_triage version newer than the approved one is waiting for the Chief Medical Officer. */
  pending: boolean;
  version: number | null;
  approvedVersion: number | null;
  note: string | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

const UNREADABLE: PendingGlucoseTriageSignoff = { pending: false, version: null, approvedVersion: null, note: null, failed: true };

/**
 * What the glucose rule set needs from the Chief Medical Officer, for the sign-off hub. Never throws; a failed read says so instead of looking like
 * nothing is outstanding. triage_rule_sets is not in the generated types yet (the blood pressure reader reads it the same way).
 */
export async function readPendingGlucoseTriageSignoff(supabase: SupabaseClient<Database>): Promise<PendingGlucoseTriageSignoff> {
  try {
    const loose = supabase as unknown as {
      from(table: string): { select(columns: string): { eq(column: string, value: string): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
    };
    const { data, error } = await loose.from("triage_rule_sets").select("id, version, status, note").eq("code", "glucose_care_triage");
    if (error || !Array.isArray(data)) return UNREADABLE;
    const rows = data as Array<{ version: number; status: string; note: string | null }>;
    const approved = rows.filter((r) => r.status === "approved").sort((a, b) => b.version - a.version)[0] ?? null;
    const draft = rows.filter((r) => r.status === "draft" && r.version > (approved?.version ?? 0)).sort((a, b) => b.version - a.version)[0] ?? null;
    return { pending: draft !== null, version: draft?.version ?? null, approvedVersion: approved?.version ?? null, note: draft?.note ?? null, failed: false };
  } catch {
    return UNREADABLE;
  }
}

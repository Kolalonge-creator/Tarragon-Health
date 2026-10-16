import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** The hub line key for the vitals triage rule set draft (pulse, SpO2, temperature). */
export const VITALS_TRIAGE_ITEM_KEY = "vitals_triage_rule_set";

export type PendingVitalsTriageSignoff = {
  /** A draft vitals_care_triage version newer than the approved one is waiting for the Chief Medical Officer. */
  pending: boolean;
  version: number | null;
  approvedVersion: number | null;
  note: string | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

const UNREADABLE: PendingVitalsTriageSignoff = { pending: false, version: null, approvedVersion: null, note: null, failed: true };

/** What the vitals rule set needs from the Chief Medical Officer, for the sign-off hub. Never throws; a failed read says so instead of looking like nothing is outstanding. */
export async function readPendingVitalsTriageSignoff(supabase: SupabaseClient<Database>): Promise<PendingVitalsTriageSignoff> {
  try {
    const loose = supabase as unknown as {
      from(table: string): { select(columns: string): { eq(column: string, value: string): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
    };
    const { data, error } = await loose.from("triage_rule_sets").select("id, version, status, note").eq("code", "vitals_care_triage");
    if (error || !Array.isArray(data)) return UNREADABLE;
    const rows = data as Array<{ version: number; status: string; note: string | null }>;
    const approved = rows.filter((r) => r.status === "approved").sort((a, b) => b.version - a.version)[0] ?? null;
    const draft = rows.filter((r) => r.status === "draft" && r.version > (approved?.version ?? 0)).sort((a, b) => b.version - a.version)[0] ?? null;
    return { pending: draft !== null, version: draft?.version ?? null, approvedVersion: approved?.version ?? null, note: draft?.note ?? null, failed: false };
  } catch {
    return UNREADABLE;
  }
}

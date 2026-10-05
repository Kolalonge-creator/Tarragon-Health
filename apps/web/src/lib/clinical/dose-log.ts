import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";

/**
 * A patient's dose log history for the clinician chart, through the audited, tie-gated read (INV-10, INV-12, S05f). The raw table
 * is closed to staff; a refusal or an error must show as "not available to you", never as "No doses logged yet".
 *
 * No `server-only` import on purpose, same as audited-chart.ts.
 */

export interface DoseLogEntry {
  id: string;
  status: string;
  reason: string | null;
  logged_at: string;
  scheduled_for_date: string | null;
  scheduled_time: string | null;
  logged_by_profile_id: string | null;
  medication: { drug_name: string | null } | null;
}

export type DoseLogResult =
  | { status: "ok"; rows: DoseLogEntry[] }
  | { status: "denied" }
  | { status: "error"; message: string };

/** Turns the audited read's response into a result; a malformed response is an error, never an empty list. */
export function parseDoseLogPayload(data: unknown): DoseLogResult {
  const payload = data as { status?: unknown; rows?: unknown } | null;
  if (!payload || typeof payload !== "object") return { status: "error", message: "unexpected dose log response" };
  if (payload.status === "denied") return { status: "denied" };
  if (payload.status !== "ok" || !Array.isArray(payload.rows)) {
    return { status: "error", message: "unexpected dose log response" };
  }
  return { status: "ok", rows: payload.rows as DoseLogEntry[] };
}

export async function readMedicationDoseLogAudited(
  supabase: SupabaseClient<Database>,
  patientId: string,
  reason: string = ROUTINE_CHART_READ_REASON,
): Promise<DoseLogResult> {
  const { data, error } = await supabase.rpc("read_medication_dose_log_audited", { p_patient: patientId, p_reason: reason });
  if (error) return { status: "error", message: error.message };
  return parseDoseLogPayload(data);
}

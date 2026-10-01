import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Staff reads of a patient's record through the audited path (INV-10, S05/S05b), instead of a direct table read.
 *
 * `public.read_patient_chart_audited` gates each section by the care-access category and by the caller's tie to the patient (INV-12), and
 * writes one audit_log row per call. Callers must treat `denied` and `error` as "the data could not be read", never as "there is none":
 * an empty list that really means "you were not allowed to see it" is the silent-failure this module exists to prevent.
 *
 * No `server-only` import on purpose: the care-management case file reads from the browser.
 */

/** A fixed, human-readable reason for the routine care-team opening of a chart. The audited function needs 10+ characters. */
export const ROUTINE_CHART_READ_REASON = "Routine care team chart review";

type ViewRow<N extends "allergies" | "conditions"> = Database["public"]["Views"][N]["Row"];

/** The sections moved to the audited path so far. Add a section here as its direct staff reads are moved. */
export interface AuditedSectionRows {
  allergies: ViewRow<"allergies">[];
  conditions: ViewRow<"conditions">[];
}

export type AuditedSectionResult<K extends keyof AuditedSectionRows> =
  | { status: "ok"; rows: AuditedSectionRows[K] }
  /** Not tied to this patient, or no break-glass / support session for the category. The refusal itself is audited. */
  | { status: "denied" }
  | { status: "error"; message: string };

interface ChartPayload {
  status?: unknown;
  sections?: Record<string, unknown>;
}

export async function readAuditedSection<K extends keyof AuditedSectionRows>(
  supabase: SupabaseClient<Database>,
  patientId: string,
  section: K,
  reason: string = ROUTINE_CHART_READ_REASON,
): Promise<AuditedSectionResult<K>> {
  const { data, error } = await supabase.rpc("read_patient_chart_audited", {
    p_patient: patientId,
    p_sections: [section],
    p_reason: reason,
  });
  if (error) return { status: "error", message: error.message };

  const payload = (data ?? null) as ChartPayload | null;
  if (!payload || typeof payload !== "object") return { status: "error", message: "unexpected chart response" };
  if (payload.status === "denied") return { status: "denied" };
  const rows = payload.sections?.[section];
  if (!Array.isArray(rows)) {
    // 'partial' with the one section we asked for missing means that section was refused.
    return payload.status === "partial" ? { status: "denied" } : { status: "error", message: "section missing from chart response" };
  }
  return { status: "ok", rows: rows as AuditedSectionRows[K] };
}

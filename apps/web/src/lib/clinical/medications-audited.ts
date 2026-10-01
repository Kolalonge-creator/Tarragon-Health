import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";

/**
 * Reads of the `medications` table through the audited, tie-gated functions (INV-10, INV-12, S05f piece C).
 *
 * Staff no longer read the table directly. For the patient, a caregiver with a grant and a supporter the same functions return exactly
 * what the table policy admitted (no audit row), so the shared hooks and loaders can use one path for every viewer. A refusal or an
 * error must show as "not available to you", never as "no medicines": callers branch on `status`.
 *
 * No `server-only` import on purpose: the clinician chart reads from the browser.
 */

/** A medication row plus the condition of its linked care plan and the prescriber's name, the shape the shared hooks selected before. */
export type AuditedMedication = Tables<"medications"> & {
  care_plan: { condition: string; status: string } | null;
  added_by_profile: { full_name: string | null } | null;
};

export type MedicationsResult =
  | { status: "ok"; rows: AuditedMedication[] }
  | { status: "denied" }
  | { status: "error"; message: string };

export interface MedicationReadOptions {
  /** true: active only; false: stopped only (newest stopped first); omitted: all. */
  active?: boolean;
  /** Only this medication. */
  medicationId?: string;
  reason?: string;
}

/** Turns the audited read's response into a result; a malformed response is an error, never an empty list. */
export function parseMedicationsPayload(data: unknown): MedicationsResult {
  const payload = data as { status?: unknown; rows?: unknown } | null;
  if (!payload || typeof payload !== "object") return { status: "error", message: "unexpected medications response" };
  if (payload.status === "denied") return { status: "denied" };
  if (payload.status !== "ok" || !Array.isArray(payload.rows)) {
    return { status: "error", message: "unexpected medications response" };
  }
  return { status: "ok", rows: payload.rows as AuditedMedication[] };
}

export async function readPatientMedicationsAudited(
  supabase: SupabaseClient<Database>,
  patientId: string,
  options: MedicationReadOptions = {},
): Promise<MedicationsResult> {
  const { data, error } = await supabase.rpc("read_patient_medications_audited", {
    p_patient: patientId,
    p_reason: options.reason ?? ROUTINE_CHART_READ_REASON,
    ...(options.active === undefined ? {} : { p_active: options.active }),
    ...(options.medicationId === undefined ? {} : { p_medication: options.medicationId }),
  });
  if (error) return { status: "error", message: error.message };
  return parseMedicationsPayload(data);
}

/** For callers that want the old throw-on-failure behaviour (react-query hooks): a refusal or error throws, never reads as "none". */
export async function readPatientMedicationsOrThrow(
  supabase: SupabaseClient<Database>,
  patientId: string,
  options: MedicationReadOptions = {},
): Promise<AuditedMedication[]> {
  const result = await readPatientMedicationsAudited(supabase, patientId, options);
  if (result.status === "ok") return result.rows;
  throw new Error(result.status === "denied" ? "medications not available to you" : result.message);
}

export interface MedicationEmbed {
  patient_id: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  rx_number: string | null;
  repeats_allowed: number;
}

/** Parses the embed read: an object keyed by medication id. A malformed response throws so it cannot read as "no medicines". */
export function parseMedicationEmbeds(data: unknown): Record<string, MedicationEmbed> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("unexpected medication embeds response");
  return data as Record<string, MedicationEmbed>;
}

/**
 * Replaces the `medication:medications(...)` embed the list screens used to select. A medication the caller may not see is absent from
 * the map, so its row gets `medication: null` ("medicine not available to you"), the same as a row with no medication.
 */
export async function attachMedicationEmbeds<T extends { medication_id?: string | null }>(
  supabase: SupabaseClient<Database>,
  rows: T[],
): Promise<(T & { medication: MedicationEmbed | null })[]> {
  const ids = Array.from(new Set(rows.map((row) => row.medication_id).filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return rows.map((row) => ({ ...row, medication: null }));
  const { data, error } = await supabase.rpc("read_medication_embeds_audited", { p_ids: ids });
  if (error) throw error;
  const map = parseMedicationEmbeds(data);
  return rows.map((row) => ({ ...row, medication: (row.medication_id ? map[row.medication_id] : undefined) ?? null }));
}

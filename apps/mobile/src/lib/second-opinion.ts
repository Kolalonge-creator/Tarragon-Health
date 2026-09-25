import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

// ---------------------------------------------------------------------------
// Second opinion — pay-per-service, no plan bypass. Mirrors apps/web/src/app/
// (dashboard)/patient/second-opinion-request.tsx. A plain insert, not a
// two-step RPC: the credit gate lives in a BEFORE INSERT trigger on
// second_opinion_requests (20260831165614_second_opinion_requests.sql),
// which raises a specific, catchable error when no credit exists — this file
// never pre-checks credit balance client-side, same reasoning as
// care-support.ts's ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER.
// ---------------------------------------------------------------------------

export type SecondOpinionRequest = Tables<"second_opinion_requests">;
export type SecondOpinionRequestWithAnswerer = SecondOpinionRequest & {
  answerer: { full_name: string } | null;
};

type SecondOpinionAnswerer = NonNullable<SecondOpinionRequestWithAnswerer["answerer"]>;

/**
 * `answered_by` used to be embedded directly via
 * `clinical_staff!second_opinion_requests_answered_by_fkey(...)` — a
 * PostgREST embedded join, which resolves against `clinical_staff`'s OWN
 * RLS, not this query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would
 * silently come back null for every patient viewing their own answered
 * request. Fetching the answerer separately from
 * public.clinical_staff_directory (the safe-column view every
 * patient-facing clinical_staff read now uses) restores the same
 * attribution without reopening the column-exposure gap that migration
 * fixed. Mirrors apps/web/src/lib/queries/second-opinion.ts's
 * fetchAnswerers.
 */
async function fetchAnswerers(answererIds: string[]): Promise<Map<string, SecondOpinionAnswerer>> {
  const answererById = new Map<string, SecondOpinionAnswerer>();
  if (answererIds.length === 0) return answererById;
  const { data, error } = await supabase.from("clinical_staff_directory").select("id, full_name").in("id", answererIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    answererById.set(row.id, { full_name: row.full_name ?? "" });
  }
  return answererById;
}

/** Matches the trigger's raised text exactly: 'Buy a second opinion credit
 * to send this request.' (second_opinion_requests_enforce_credit). */
export const SECOND_OPINION_CREDIT_REQUIRED_MARKER = "second opinion credit";

/** The service_products code this request spends — see
 * private.enforce_second_opinion_credit and platform-credit.ts's
 * trySpendPlatformCreditForService, which the section calls with this code
 * to settle the credit from platform credit in-app before retrying. */
export const SECOND_OPINION_CREDIT_CODE = "second_opinion_credit";

export async function loadMySecondOpinionRequests(
  patientId: string
): Promise<QueryResult<SecondOpinionRequestWithAnswerer[]>> {
  try {
    const { data, error } = await supabase
      .from("second_opinion_requests")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return { ok: false, error: error.message };

    const rows = data ?? [];
    const answererIds = Array.from(new Set(rows.map((row) => row.answered_by).filter((id): id is string => !!id)));
    const answererById = await fetchAnswerers(answererIds);

    return {
      ok: true,
      data: rows.map((row) => ({
        ...row,
        answerer: row.answered_by ? (answererById.get(row.answered_by) ?? null) : null,
      })) as SecondOpinionRequestWithAnswerer[],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function submitSecondOpinionRequest(input: {
  patientId: string;
  organisationId: string;
  existingDiagnosisOrResult: string;
  sourceDescription?: string;
  specificQuestion?: string;
}): Promise<QueryResult<null>> {
  const { error } = await supabase.from("second_opinion_requests").insert({
    patient_id: input.patientId,
    organisation_id: input.organisationId,
    existing_diagnosis_or_result: input.existingDiagnosisOrResult,
    source_description: input.sourceDescription || null,
    specific_question: input.specificQuestion || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

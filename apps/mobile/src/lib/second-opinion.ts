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
  answerer: { full_name: string; credential_type: string | null; credential_number: string | null } | null;
};

/** Matches the trigger's raised text exactly: 'Buy a second opinion credit
 * to send this request.' (second_opinion_requests_enforce_credit). */
export const SECOND_OPINION_CREDIT_REQUIRED_MARKER = "second opinion credit";

export async function loadMySecondOpinionRequests(
  patientId: string
): Promise<QueryResult<SecondOpinionRequestWithAnswerer[]>> {
  const { data, error } = await supabase
    .from("second_opinion_requests")
    .select(
      "*, answerer:clinical_staff!second_opinion_requests_answered_by_fkey(full_name, credential_type, credential_number)"
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as SecondOpinionRequestWithAnswerer[] };
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

import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

// ---------------------------------------------------------------------------
// Senior case review — pay-per-service, no plan bypass. Mirrors apps/web/src/
// app/(dashboard)/patient/senior-case-review-card.tsx. A plain insert, not a
// two-step RPC: the credit gate lives in a BEFORE INSERT trigger on
// senior_case_reviews (20260831171703_senior_case_reviews.sql), which raises
// a specific, catchable error when no credit exists — this file never
// pre-checks credit balance client-side, same reasoning as care-support.ts's
// ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER.
// ---------------------------------------------------------------------------

export type SeniorCaseReview = Tables<"senior_case_reviews">;
export type SeniorCaseReviewWithReviewer = SeniorCaseReview & {
  reviewer: { full_name: string; credential_type: string | null; credential_number: string | null } | null;
};

/** Matches the trigger's raised text exactly: 'Buy a senior case review
 * credit to request this.' (senior_case_reviews_enforce_credit). */
export const SENIOR_CASE_REVIEW_CREDIT_REQUIRED_MARKER = "senior case review credit";

export async function loadMySeniorCaseReviews(
  patientId: string
): Promise<QueryResult<SeniorCaseReviewWithReviewer[]>> {
  const { data, error } = await supabase
    .from("senior_case_reviews")
    .select(
      "*, reviewer:clinical_staff!senior_case_reviews_reviewed_by_fkey(full_name, credential_type, credential_number)"
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as SeniorCaseReviewWithReviewer[] };
}

export async function submitSeniorCaseReview(input: {
  patientId: string;
  organisationId: string;
  situationSummary: string;
}): Promise<QueryResult<null>> {
  const { error } = await supabase.from("senior_case_reviews").insert({
    patient_id: input.patientId,
    organisation_id: input.organisationId,
    situation_summary: input.situationSummary,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

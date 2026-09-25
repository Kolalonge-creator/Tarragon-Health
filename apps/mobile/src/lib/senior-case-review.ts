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
  reviewer: { full_name: string } | null;
};

type SeniorCaseReviewer = NonNullable<SeniorCaseReviewWithReviewer["reviewer"]>;

/**
 * `reviewed_by` used to be embedded directly via
 * `clinical_staff!senior_case_reviews_reviewed_by_fkey(...)` — a PostgREST
 * embedded join, which resolves against `clinical_staff`'s OWN RLS, not
 * this query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would
 * silently come back null for every patient viewing their own review.
 * Fetching the reviewer separately from public.clinical_staff_directory
 * (the safe-column view every patient-facing clinical_staff read now uses)
 * restores the same attribution without reopening the column-exposure gap
 * that migration fixed. Mirrors
 * apps/web/src/lib/queries/senior-case-review.ts's fetchReviewers.
 */
async function fetchReviewers(reviewerIds: string[]): Promise<Map<string, SeniorCaseReviewer>> {
  const reviewerById = new Map<string, SeniorCaseReviewer>();
  if (reviewerIds.length === 0) return reviewerById;
  const { data, error } = await supabase.from("clinical_staff_directory").select("id, full_name").in("id", reviewerIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    reviewerById.set(row.id, { full_name: row.full_name ?? "" });
  }
  return reviewerById;
}

/** Matches the trigger's raised text exactly: 'Buy a senior case review
 * credit to request this.' (senior_case_reviews_enforce_credit). */
export const SENIOR_CASE_REVIEW_CREDIT_REQUIRED_MARKER = "senior case review credit";

/** The service_products code this request spends — see
 * platform-credit.ts's trySpendPlatformCreditForService. */
export const SENIOR_CASE_REVIEW_CREDIT_CODE = "senior_case_review_credit";

export async function loadMySeniorCaseReviews(
  patientId: string
): Promise<QueryResult<SeniorCaseReviewWithReviewer[]>> {
  try {
    const { data, error } = await supabase
      .from("senior_case_reviews")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return { ok: false, error: error.message };

    const rows = data ?? [];
    const reviewerIds = Array.from(new Set(rows.map((row) => row.reviewed_by).filter((id): id is string => !!id)));
    const reviewerById = await fetchReviewers(reviewerIds);

    return {
      ok: true,
      data: rows.map((row) => ({
        ...row,
        reviewer: row.reviewed_by ? (reviewerById.get(row.reviewed_by) ?? null) : null,
      })) as SeniorCaseReviewWithReviewer[],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type AnnualReview = Tables<"annual_reviews">;
export type AnnualReviewWorkupItem = Tables<"annual_review_workup_items">;

/** Clinician credential embed for null-gated "Reviewed by Dr X" attribution. */
type ReviewingStaff = {
  full_name: string | null;
  credential_type: string | null;
  credential_number: string | null;
} | null;

export type AnnualReviewConsult = {
  id: string;
  proposed_slots: string[] | null;
  scheduled_at: string | null;
  join_url: string | null;
  status: string;
} | null;

export type AnnualReviewWithContext = AnnualReview & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  reviewed_by_staff: ReviewingStaff;
  workup_items: AnnualReviewWorkupItem[];
  video_consult: AnnualReviewConsult;
};

const REVIEW_SELECT =
  "*, patient:profiles!annual_reviews_patient_id_fkey(full_name, patient_number), reviewed_by_staff:clinical_staff!annual_reviews_reviewed_by_fkey(full_name, credential_type, credential_number), workup_items:annual_review_workup_items(*), video_consult:video_consultations!annual_reviews_video_consultation_id_fkey(id, proposed_slots, scheduled_at, join_url, status)";

const patientKey = (patientId: string) => ["annual-reviews", "patient", patientId] as const;
const orgKey = ["annual-reviews", "org"] as const;

/**
 * The patient's most recent annual review (this cycle first) with its workup
 * checklist and null-gated reviewer attribution. Null when the patient has
 * never had one opened (not yet entitled, or scheduler hasn't run for them).
 */
export function usePatientAnnualReview(patientId: string) {
  return useQuery({
    queryKey: patientKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("annual_reviews")
        .select(REVIEW_SELECT)
        .eq("patient_id", patientId)
        .order("cycle_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as AnnualReviewWithContext | null) ?? null;
    },
    enabled: !!patientId,
  });
}

/**
 * Org-staff worklist — open annual reviews (pending/in_progress), soonest-due
 * first. RLS (private.is_org_staff) scopes to the caller's organisation.
 */
export function useOrgAnnualReviews() {
  return useQuery({
    queryKey: orgKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("annual_reviews")
        .select(REVIEW_SELECT)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data as AnnualReviewWithContext[]) ?? [];
    },
  });
}

/**
 * Advance the ordered pathway: stamp a stage's completion column, move
 * current_stage forward, and flip a still-pending review to in_progress. The
 * caller passes only the columns the acted-on stage owns. Completing the
 * medication_review stage triggers the DB-side reconciliation that adopts +
 * rolls the patient's condition medication reviews.
 */
export function useAdvanceAnnualReviewStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      reviewId,
      patch,
    }: {
      reviewId: string;
      patch: Partial<
        Pick<
          AnnualReview,
          | "current_stage"
          | "status"
          | "questionnaire_completed_at"
          | "labs_completed_at"
          | "medication_review_completed_at"
          | "risk_score_computed_at"
          | "care_plan_updated_at"
          | "video_completed_at"
          | "year_summary"
          | "notes"
        >
      >;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("annual_reviews").update(patch).eq("id", reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["annual-reviews"] });
    },
  });
}

/**
 * Mark the whole annual review complete. reviewed_by/completed_at/current_stage
 * are stamped server-side by private.stamp_annual_review_completion from the
 * caller's own clinical_staff row — never sent from here — so the "Reviewed by
 * Dr X" line can never be forged.
 */
export function useCompleteAnnualReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      reviewId,
      yearSummary,
    }: {
      reviewId: string;
      yearSummary: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("annual_reviews")
        .update({ status: "completed", year_summary: yearSummary })
        .eq("id", reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["annual-reviews"] });
    },
  });
}

export type WorkupCatalogueItem = Tables<"annual_review_workup_catalogue">;

/** The full workup catalogue — powers the clinician "add item" picker. */
export function useWorkupCatalogue() {
  return useQuery({
    queryKey: ["annual-reviews", "workup-catalogue"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("annual_review_workup_catalogue")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as WorkupCatalogueItem[]) ?? [];
    },
  });
}

/** Update a single general-workup checklist item (status / result note). */
export function useUpdateWorkupItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      status,
      resultSummary,
    }: {
      itemId: string;
      status: AnnualReviewWorkupItem["status"];
      resultSummary: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("annual_review_workup_items")
        .update({
          status,
          result_summary: resultSummary,
          completed_at: status === "completed" ? new Date().toISOString() : null,
        })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["annual-reviews"] });
    },
  });
}

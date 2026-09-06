import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SeniorCaseReview = Tables<"senior_case_reviews">;

export type SeniorCaseReviewWithAnswerer = SeniorCaseReview & {
  reviewer: {
    full_name: string;
    credential_type: string | null;
    credential_number: string | null;
  } | null;
};

export type SeniorCaseReviewWithPatient = SeniorCaseReview & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

export const seniorCaseReviewKeys = {
  mine: (patientId: string) => ["senior-case-reviews", "mine", patientId] as const,
  org: ["senior-case-reviews", "org"] as const,
};

export function useMySeniorCaseReviews(patientId: string) {
  return useQuery({
    queryKey: seniorCaseReviewKeys.mine(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("senior_case_reviews")
        .select(
          "*, reviewer:clinical_staff!senior_case_reviews_reviewed_by_fkey(full_name, credential_type, credential_number)"
        )
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as SeniorCaseReviewWithAnswerer[];
    },
  });
}

/** Patient requests a review — senior_case_reviews_enforce_credit (the DB
 * trigger) redeems one senior_case_review_credit or rejects the insert. */
export function useRequestSeniorCaseReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      situationSummary,
    }: {
      patientId: string;
      organisationId: string;
      situationSummary: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("senior_case_reviews").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        situation_summary: situationSummary,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: seniorCaseReviewKeys.mine(variables.patientId) });
    },
  });
}

/** Doctor-side worklist. */
export function useOrgSeniorCaseReviews() {
  return useQuery({
    queryKey: seniorCaseReviewKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("senior_case_reviews")
        .select(
          "*, patient:profiles!senior_case_reviews_patient_id_fkey(full_name, patient_number)"
        )
        .in("status", ["submitted", "in_review"])
        .order("sla_due_at", { ascending: true });
      if (error) throw error;
      return data as SeniorCaseReviewWithPatient[];
    },
  });
}

export function useMarkSeniorCaseReviewInReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reviewId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("senior_case_reviews")
        .update({ status: "in_review" })
        .eq("id", reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seniorCaseReviewKeys.org });
    },
  });
}

/** Completes or declines — only accepted server-side from a Tier 3+ doctor
 * or Clinical Director (private.stamp_senior_case_review); a junior doctor's
 * attempt fails with a clear 42501, surfaced as-is to the UI. */
export function useDecideSeniorCaseReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input:
        | { reviewId: string; decision: "completed"; writtenPlan: string }
        | { reviewId: string; decision: "declined"; declinedReason?: string }
    ) => {
      const supabase = createClient();
      const payload =
        input.decision === "completed"
          ? { status: "completed" as const, written_plan: input.writtenPlan }
          : { status: "declined" as const, declined_reason: input.declinedReason || null };
      const { error } = await supabase.from("senior_case_reviews").update(payload).eq("id", input.reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seniorCaseReviewKeys.org });
    },
  });
}

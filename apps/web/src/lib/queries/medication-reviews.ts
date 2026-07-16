import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type MedicationReview = Tables<"medication_reviews">;

export type MedicationReviewWithContext = MedicationReview & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  care_plan: { condition: string } | null;
};

const REVIEW_WORKLIST_SELECT =
  "*, patient:profiles!medication_reviews_patient_id_fkey(full_name, patient_number), care_plan:care_plans!medication_reviews_care_plan_id_fkey(condition)";

/**
 * The patient's next upcoming medication review (earliest pending), for the
 * "digital medicines cabinet" — null when none is scheduled.
 */
export function usePatientNextReview(patientId: string) {
  return useQuery({
    queryKey: ["medication-reviews", "next", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_reviews")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as MedicationReview | null;
    },
    enabled: !!patientId,
  });
}

/**
 * Org staff worklist — pending medication reviews, soonest-due first (overdue
 * float to the top). RLS (private.is_org_staff) scopes to the caller's org.
 */
export function useOrgMedicationReviews() {
  return useQuery({
    queryKey: ["medication-reviews", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_reviews")
        .select(REVIEW_WORKLIST_SELECT)
        .eq("status", "pending")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as MedicationReviewWithContext[];
    },
  });
}

/**
 * Complete a review. reviewed_by/completed_at are stamped server-side by
 * private.stamp_medication_review_completion from the caller's clinical_staff
 * row — never sent from here — and completing rolls the next review at cadence.
 */
export function useCompleteMedicationReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reviewId, notes }: { reviewId: string; notes: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_reviews")
        .update({ status: "completed", notes })
        .eq("id", reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["medication-reviews"] });
    },
  });
}

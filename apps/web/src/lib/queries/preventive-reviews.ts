import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PreventiveReview = Tables<"preventive_reviews">;

export type PreventiveReviewWithContext = PreventiveReview & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  enrolment: { programme: { name: string; code: string } | null } | null;
};

const REVIEW_WORKLIST_SELECT =
  "*, patient:profiles!preventive_reviews_patient_id_fkey(full_name, patient_number), " +
  "enrolment:preventive_programme_enrolments!preventive_reviews_enrolment_id_fkey(programme:preventive_programmes(name, code))";

/**
 * The patient's next upcoming periodic health review (earliest pending) — null
 * when none is scheduled (i.e. not enrolled in any programme).
 */
export function usePatientNextPreventiveReview(patientId: string) {
  return useQuery({
    queryKey: ["preventive-reviews", "next", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("preventive_reviews")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as PreventiveReview | null;
    },
    enabled: !!patientId,
  });
}

/**
 * Org staff worklist — pending periodic reviews, soonest-due first. RLS
 * (private.is_org_staff) scopes to the caller's organisation.
 */
export function useOrgPreventiveReviews() {
  return useQuery({
    queryKey: ["preventive-reviews", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("preventive_reviews")
        .select(REVIEW_WORKLIST_SELECT)
        .eq("status", "pending")
        .order("due_date", { ascending: true });
      if (error) throw error;
      // Nested embed aliases defeat the generated row typing; the runtime shape
      // matches PreventiveReviewWithContext.
      return data as unknown as PreventiveReviewWithContext[];
    },
  });
}

/**
 * Complete a periodic review. reviewed_by/completed_at are stamped server-side
 * by private.stamp_preventive_review_completion from the caller's clinical_staff
 * row — never sent from here — and completing rolls the next review at the
 * programme's cadence.
 */
export function useCompletePreventiveReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reviewId, notes }: { reviewId: string; notes: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("preventive_reviews")
        .update({ status: "completed", notes })
        .eq("id", reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preventive-reviews"] });
    },
  });
}

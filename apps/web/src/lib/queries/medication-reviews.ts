import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { writableTable } from "@/lib/supabase/pending-schema-overrides";
import type { MedicationReviewEffectiveness } from "@/lib/supabase/pending-schema-overrides";
import type { Tables } from "@tarragon/shared";

export type { MedicationReviewEffectiveness };

// medication_reviews reads fine through the plain generated Tables<> type
// (see pending-schema-overrides.ts's header) but gained 7 structured-domain
// columns this migration set adds ahead of the next `database.types.ts`
// regeneration, so the domain type here widens it by hand.
export type MedicationReview = Tables<"medication_reviews"> & {
  effectiveness_assessment: MedicationReviewEffectiveness | null;
  adherence_reviewed: boolean;
  side_effects_reviewed: boolean;
  affordability_reviewed: boolean;
  affordability_barrier_identified: boolean | null;
  monitoring_reviewed: boolean;
  ongoing_indication_confirmed: boolean | null;
  patient_preference_notes: string | null;
};

export type MedicationReviewWithContext = MedicationReview & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  care_plan: { condition: string } | null;
};

export interface CompleteMedicationReviewInput {
  reviewId: string;
  notes: string | null;
  effectivenessAssessment?: MedicationReviewEffectiveness | null;
  adherenceReviewed?: boolean;
  sideEffectsReviewed?: boolean;
  affordabilityReviewed?: boolean;
  affordabilityBarrierIdentified?: boolean | null;
  monitoringReviewed?: boolean;
  ongoingIndicationConfirmed?: boolean | null;
  patientPreferenceNotes?: string | null;
}

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
      return data as unknown as MedicationReview | null;
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
      return data as unknown as MedicationReviewWithContext[];
    },
  });
}

/**
 * Complete a review. reviewed_by/completed_at are stamped server-side by
 * private.stamp_medication_review_completion from the caller's clinical_staff
 * row — never sent from here — and completing rolls the next review at
 * cadence. The structured domain fields (13.11) are all optional so a
 * reviewer can complete with just notes, matching prior behaviour, or fill in
 * as many of the seven assessed domains as the review actually covered. Goes
 * through writableTable() because those 7 columns predate the generated
 * Update type.
 */
export function useCompleteMedicationReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      reviewId,
      notes,
      effectivenessAssessment,
      adherenceReviewed,
      sideEffectsReviewed,
      affordabilityReviewed,
      affordabilityBarrierIdentified,
      monitoringReviewed,
      ongoingIndicationConfirmed,
      patientPreferenceNotes,
    }: CompleteMedicationReviewInput) => {
      const { error } = await writableTable("medication_reviews")
        .update({
          status: "completed",
          notes,
          effectiveness_assessment: effectivenessAssessment ?? null,
          adherence_reviewed: adherenceReviewed ?? false,
          side_effects_reviewed: sideEffectsReviewed ?? false,
          affordability_reviewed: affordabilityReviewed ?? false,
          affordability_barrier_identified: affordabilityBarrierIdentified ?? null,
          monitoring_reviewed: monitoringReviewed ?? false,
          ongoing_indication_confirmed: ongoingIndicationConfirmed ?? null,
          patient_preference_notes: patientPreferenceNotes ?? null,
        })
        .eq("id", reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["medication-reviews"] });
    },
  });
}

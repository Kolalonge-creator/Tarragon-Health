import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type WeightManagementEnrolment = Tables<"weight_management_enrolments">;
export type WeightManagementCheckin = Tables<"weight_management_checkins">;
export type WeightManagementDoseStep = Tables<"weight_management_dose_steps">;

/**
 * Supervised Weight Management.
 *
 * Tarragon supervises people taking weight-loss medication they obtained
 * themselves. It does not prescribe or supply it, and that is structural rather
 * than a claim in copy: private.enforce_weight_management_supervision_only
 * refuses an enrolment against any medication whose source is not 'patient'.
 * Nothing in this file should try to work around that.
 *
 * Nor does anything here decide eligibility. Only clinical staff can move an
 * enrolment to 'active' (the RLS update policy admits org staff alone), and the
 * table's own CHECK requires a recorded obesity assessment and a named
 * supervising clinician before it can get there. A BMI threshold is
 * deliberately not encoded anywhere: thresholds differ by comorbidity and the
 * judgement belongs to the doctor.
 */
export const weightManagementKeys = {
  enrolment: ["weight-management", "enrolment"] as const,
  checkins: ["weight-management", "checkins"] as const,
  doseSteps: ["weight-management", "dose-steps"] as const,
};

/** The one live enrolment, if any. A partial unique index guarantees at most one. */
export function useMyWeightManagementEnrolment(patientId: string) {
  return useQuery({
    queryKey: [...weightManagementKeys.enrolment, patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("weight_management_enrolments")
        .select("*")
        .eq("patient_id", patientId)
        .in("status", ["pending_eligibility", "active", "paused"])
        .maybeSingle();
      if (error) throw error;
      return data as WeightManagementEnrolment | null;
    },
  });
}

export function useWeightManagementCheckins(enrolmentId: string | null) {
  return useQuery({
    queryKey: [...weightManagementKeys.checkins, enrolmentId],
    enabled: !!enrolmentId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("weight_management_checkins")
        .select("*")
        .eq("enrolment_id", enrolmentId!)
        .order("checked_in_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data as WeightManagementCheckin[];
    },
  });
}

export function useWeightManagementDoseSteps(enrolmentId: string | null) {
  return useQuery({
    queryKey: [...weightManagementKeys.doseSteps, enrolmentId],
    enabled: !!enrolmentId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("weight_management_dose_steps")
        .select("*")
        .eq("enrolment_id", enrolmentId!)
        .order("step_number", { ascending: true });
      if (error) throw error;
      return data as WeightManagementDoseStep[];
    },
  });
}

/**
 * The fortnightly tolerability check-in.
 *
 * Symptom scores are 0-3 (none / mild / moderate / severe). `red_flag_reported`
 * is not a severity — it is the presentations that need a doctor the same day
 * rather than at the next review: severe persistent abdominal pain radiating to
 * the back, which is how pancreatitis presents, and persistent vomiting with
 * poor oral intake. It is asked as its own explicit question rather than
 * inferred from the scores, because inferring it would mean deciding on the
 * patient's behalf what counts as severe.
 */
export function useSubmitWeightCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      enrolmentId: string;
      patientId: string;
      weightKg?: number | null;
      nausea: number;
      vomiting: number;
      diarrhoea: number;
      constipation: number;
      abdominalPain: number;
      poorOralIntake: boolean;
      redFlagReported: boolean;
      patientNote?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("weight_management_checkins").insert({
        organisation_id: input.organisationId,
        enrolment_id: input.enrolmentId,
        patient_id: input.patientId,
        weight_kg: input.weightKg ?? null,
        nausea: input.nausea,
        vomiting: input.vomiting,
        diarrhoea: input.diarrhoea,
        constipation: input.constipation,
        abdominal_pain: input.abdominalPain,
        poor_oral_intake: input.poorOralIntake,
        red_flag_reported: input.redFlagReported,
        patient_note: input.patientNote ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: weightManagementKeys.checkins });
    },
  });
}

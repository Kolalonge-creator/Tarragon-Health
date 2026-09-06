import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CarePlanDecision = Tables<"care_plan_decisions">;

export const carePlanDecisionKeys = {
  patient: (patientId: string) => ["care-plan-decisions", "patient", patientId] as const,
};

/**
 * §3.17's shared decision-making record: recommended option, alternatives,
 * patient preference, agreed plan, reason. Append-only — no update/delete
 * policy (see the migration), so this is a full history, not a live form.
 */
export function useCarePlanDecisions(patientId: string | null) {
  return useQuery({
    queryKey: carePlanDecisionKeys.patient(patientId ?? ""),
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_decisions")
        .select("*")
        .eq("patient_id", patientId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CarePlanDecision[];
    },
  });
}

/**
 * Records a shared decision-making conversation. decided_by is stamped
 * server-side from the caller's own clinical_staff row — never sent from
 * here (see private.stamp_care_plan_decision_author).
 */
export function useCreateCarePlanDecision(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      carePlanId?: string | null;
      goalId?: string | null;
      recommendedOption: string;
      alternatives?: string[];
      patientPreference?: string;
      agreedPlan: string;
      reason?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("care_plan_decisions").insert({
        organisation_id: input.organisationId,
        patient_id: patientId,
        care_plan_id: input.carePlanId ?? null,
        goal_id: input.goalId ?? null,
        recommended_option: input.recommendedOption,
        alternatives: input.alternatives ?? [],
        patient_preference: input.patientPreference ?? null,
        agreed_plan: input.agreedPlan,
        reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: carePlanDecisionKeys.patient(patientId) });
    },
  });
}

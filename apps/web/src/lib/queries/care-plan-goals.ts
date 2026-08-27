import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database, Enums, Tables } from "@tarragon/shared";

export type CarePlanGoal = Tables<"care_plan_goals">;
export type CarePlanGoalStatus = Enums<"care_plan_goal_status">;
type CarePlanGoalUpdate = Database["public"]["Tables"]["care_plan_goals"]["Update"];

export const carePlanGoalKeys = {
  patient: (patientId: string) => ["care-plan-goals", "patient", patientId] as const,
};

export function useCarePlanGoals(patientId: string | null) {
  return useQuery({
    queryKey: carePlanGoalKeys.patient(patientId ?? ""),
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_goals")
        .select("*")
        .eq("patient_id", patientId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CarePlanGoal[];
    },
  });
}

/**
 * A patient proposing their own goal (§3.16). Always status='proposed',
 * source='patient' — the insert RLS policy requires exactly this shape (see
 * the care_plan_goals migration), so a patient can never insert an
 * already-active or clinician-attributed goal this way.
 */
export function useProposeCarePlanGoal(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      description: string;
      metric?: string;
      targetValue?: number;
      targetUnit?: string;
      targetDate?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("care_plan_goals").insert({
        organisation_id: input.organisationId,
        patient_id: patientId,
        description: input.description,
        metric: input.metric ?? null,
        target_value: input.targetValue ?? null,
        target_unit: input.targetUnit ?? null,
        target_date: input.targetDate ?? null,
        status: "proposed",
        source: "patient",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: carePlanGoalKeys.patient(patientId) });
    },
  });
}

/**
 * Clinician approves (-> active), modifies, or abandons a goal — including
 * one a patient proposed (§3.16: "Clinicians can approve or modify goals
 * where clinically relevant"). approved_by/approved_at are stamped
 * server-side on the transition into 'active'; never sent from here.
 */
export function useUpdateCarePlanGoal(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      status,
      description,
      metric,
      targetValue,
      targetUnit,
      targetDate,
    }: {
      goalId: string;
      status?: CarePlanGoalStatus;
      description?: string;
      metric?: string | null;
      targetValue?: number | null;
      targetUnit?: string | null;
      targetDate?: string | null;
    }) => {
      const supabase = createClient();
      const update: CarePlanGoalUpdate = {};
      if (status !== undefined) update.status = status;
      if (description !== undefined) update.description = description;
      if (metric !== undefined) update.metric = metric;
      if (targetValue !== undefined) update.target_value = targetValue;
      if (targetUnit !== undefined) update.target_unit = targetUnit;
      if (targetDate !== undefined) update.target_date = targetDate;

      const { error } = await supabase.from("care_plan_goals").update(update).eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: carePlanGoalKeys.patient(patientId) });
    },
  });
}

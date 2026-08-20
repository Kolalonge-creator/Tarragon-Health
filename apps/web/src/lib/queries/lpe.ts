import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getWeeklyPlan, markGoalDone, type WeeklyPlanGoal } from "@/lib/lpe/weekly-plan";

export function weeklyPlanKey(patientId: string) {
  return ["weekly-plan", patientId] as const;
}

export function useWeeklyPlan(patientId: string) {
  return useQuery({
    queryKey: weeklyPlanKey(patientId),
    queryFn: () => getWeeklyPlan(createClient(), patientId),
    enabled: !!patientId,
  });
}

export function useMarkGoalDone(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      goal: Pick<WeeklyPlanGoal, "organisationId" | "enrollmentId" | "measurementType">
    ) => markGoalDone(createClient(), goal, patientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: weeklyPlanKey(patientId) });
    },
  });
}

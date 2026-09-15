import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PatientGoal = Tables<"patient_goals">;
export type PatientGoalProgress = Tables<"patient_goal_progress">;
export type PatientMilestone = Tables<"patient_milestones">;

export function usePatientGoals(patientId: string) {
  return useQuery({
    queryKey: ["patient-goals", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_goals")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PatientGoal[];
    },
    enabled: !!patientId,
  });
}

/** Last 14 entries — enough to draw the trend the spec's own §16.11 example
 * shows (a short run of daily values), not the whole history. */
export function useGoalProgress(goalId: string) {
  return useQuery({
    queryKey: ["patient-goal-progress", goalId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_goal_progress")
        .select("*")
        .eq("goal_id", goalId)
        .order("logged_date", { ascending: false })
        .limit(14);
      if (error) throw error;
      return (data as PatientGoalProgress[]).reverse();
    },
    enabled: !!goalId,
  });
}

export function usePatientMilestones(patientId: string, limit = 5) {
  return useQuery({
    queryKey: ["patient-milestones", patientId, limit],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_milestones")
        .select("*")
        .eq("patient_id", patientId)
        .order("achieved_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as PatientMilestone[];
    },
    enabled: !!patientId,
  });
}

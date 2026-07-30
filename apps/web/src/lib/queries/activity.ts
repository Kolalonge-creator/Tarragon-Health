import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ActivityGoal = Tables<"patient_activity_goals">;
export type ActivityEntry = Tables<"activity_log_entries">;

export function useActivityGoal(patientId: string) {
  return useQuery({
    queryKey: ["activity-goal", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_activity_goals")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

/** Today's logged step count (Africa/Lagos calendar day), for the ring. */
export function useTodaySteps(patientId: string) {
  return useQuery({
    queryKey: ["today-steps", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
      const { data, error } = await supabase
        .from("activity_log_entries")
        .select("step_count")
        .eq("patient_id", patientId)
        .eq("entry_type", "steps")
        .eq("logged_on", today)
        .maybeSingle();
      if (error) throw error;
      return data?.step_count ?? 0;
    },
    enabled: !!patientId,
  });
}

/** Reverse-chronological activity history (steps + workouts mixed), for the
 * "Today" / date-grouped feed. */
export function useActivityEntries(patientId: string, limit = 30) {
  return useQuery({
    queryKey: ["activity-entries", patientId, limit],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("activity_log_entries")
        .select("*")
        .eq("patient_id", patientId)
        .order("logged_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as ActivityEntry[];
    },
    enabled: !!patientId,
  });
}

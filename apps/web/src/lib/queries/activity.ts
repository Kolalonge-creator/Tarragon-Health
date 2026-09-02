import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import { classifyActivity, moderateEquivalentMinutes } from "@/lib/activity/intensity";

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

/** Real progress toward WHO's weekly activity guideline (150 min moderate,
 * or 75 vigorous counting double), summed from the patient's actual logged
 * workouts over the trailing 7 days — cumulative, not the single-session
 * estimate the marketing activity calculator gives an anonymous visitor. */
export function useWeeklyActivityMinutes(patientId: string) {
  return useQuery({
    queryKey: ["weekly-activity-minutes", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("activity_log_entries")
        .select("activity_name, duration_minutes")
        .eq("patient_id", patientId)
        .eq("entry_type", "workout")
        .gte("logged_at", since);
      if (error) throw error;

      return (data ?? []).reduce((total, row) => {
        if (!row.activity_name || row.duration_minutes == null) return total;
        const { intensity } = classifyActivity(row.activity_name);
        return total + moderateEquivalentMinutes(intensity, row.duration_minutes);
      }, 0);
    },
    enabled: !!patientId,
  });
}

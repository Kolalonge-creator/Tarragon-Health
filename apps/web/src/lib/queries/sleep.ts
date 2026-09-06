import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SleepGoal = Tables<"patient_sleep_goals">;
export type SleepLogEntry = Tables<"sleep_log_entries">;

export function useSleepGoal(patientId: string) {
  return useQuery({
    queryKey: ["sleep-goal", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_sleep_goals")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useSleepLogEntries(patientId: string, limit = 30) {
  return useQuery({
    queryKey: ["sleep-log-entries", patientId, limit],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sleep_log_entries")
        .select("*")
        .eq("patient_id", patientId)
        .order("logged_on", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as SleepLogEntry[];
    },
    enabled: !!patientId,
  });
}

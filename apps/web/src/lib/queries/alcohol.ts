import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type AlcoholGoal = Tables<"patient_alcohol_goals">;
export type AlcoholConsumptionLog = Tables<"alcohol_consumption_logs">;

export function useAlcoholGoal(patientId: string) {
  return useQuery({
    queryKey: ["alcohol-goal", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_alcohol_goals")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useAlcoholConsumptionLogs(patientId: string, limit = 30) {
  return useQuery({
    queryKey: ["alcohol-consumption-logs", patientId, limit],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("alcohol_consumption_logs")
        .select("*")
        .eq("patient_id", patientId)
        .order("logged_on", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as AlcoholConsumptionLog[];
    },
    enabled: !!patientId,
  });
}

/** Sum of drinks logged in the trailing 7 calendar days (inclusive of
 * today), for comparing against a weekly reduction target. */
export function drinksThisWeek(logs: AlcoholConsumptionLog[]): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return logs
    .filter((l) => l.logged_on >= cutoffKey)
    .reduce((sum, l) => sum + l.drinks_count, 0);
}

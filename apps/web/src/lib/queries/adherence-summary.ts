import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { MedicationLog } from "@/lib/queries/medications";

/** Trailing-7-day dose logs for one patient, across all their medications —
 * the input buildWeeklyAdherenceSummary (13.7) rolls up into a %-this-week
 * figure. A separate query from useTodaysDoseLogs (which is date-pinned to
 * today only) since this deliberately spans a window. */
export function useWeeklyDoseLogs(patientId: string) {
  return useQuery({
    queryKey: ["medication-logs", "week", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const { data, error } = await supabase
        .from("medication_logs")
        .select("*")
        .eq("patient_id", patientId)
        .gte("logged_at", since.toISOString());
      if (error) throw error;
      return data as unknown as MedicationLog[];
    },
    enabled: !!patientId,
  });
}

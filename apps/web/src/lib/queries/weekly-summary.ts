import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { buildWeeklySummary, type WeeklySummary } from "@/lib/visit-report/weekly";

const FIELDS =
  "vital_type, taken_at, systolic, diastolic, pulse_bpm, glucose_mmol_l, glucose_context, weight_kg, validation_status, source";

/** The last 14 days of the subject's readings through their own RLS session, summarised as this week and last week. */
export function useWeeklySummary(patientId: string) {
  return useQuery({
    queryKey: ["weekly-summary", patientId],
    queryFn: async (): Promise<WeeklySummary> => {
      const supabase = createClient();
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select(FIELDS)
        .eq("patient_id", patientId)
        .gte("taken_at", since)
        .order("taken_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return buildWeeklySummary(data ?? [], new Date());
    },
    enabled: !!patientId,
  });
}

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { VISIT_REPORT_FIELDS } from "@/lib/visit-report/summarise";
import { buildWeeklySummary, type WeeklySummary } from "@/lib/visit-report/weekly";

const ROW_CAP = 2000;

/** The last 14 days of the subject's readings through their own RLS session, summarised as this week and last week. */
export function useWeeklySummary(patientId: string) {
  return useQuery({
    queryKey: ["weekly-summary", patientId],
    queryFn: async (): Promise<WeeklySummary> => {
      const supabase = createClient();
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select(VISIT_REPORT_FIELDS)
        .eq("patient_id", patientId)
        .gte("taken_at", since)
        // Newest first so a row cap (dense CGM or wearable feeds) drops the oldest, never this week.
        .order("taken_at", { ascending: false })
        .limit(ROW_CAP);
      if (error) throw error;
      const rows = data ?? [];
      return buildWeeklySummary(rows, new Date(), { partial: rows.length >= ROW_CAP });
    },
    enabled: !!patientId,
  });
}

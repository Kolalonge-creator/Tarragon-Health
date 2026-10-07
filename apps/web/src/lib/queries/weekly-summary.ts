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
        .from("vitals_readings_counted") // S70 (C1): count a measurement once
        .select(VISIT_REPORT_FIELDS)
        .eq("patient_id", patientId)
        .gte("taken_at", since)
        // Newest first so a row cap (dense CGM or wearable feeds) drops the oldest, never this week.
        .order("taken_at", { ascending: false })
        .limit(ROW_CAP);
      if (error) throw error;
      // The view's columns are all nullable in the generated types; a counted row always has its type and time.
      const rows = (data ?? []).flatMap((r) => (r.vital_type !== null && r.taken_at !== null ? [{ ...r, vital_type: r.vital_type, taken_at: r.taken_at, validation_status: r.validation_status ?? "valid", source: r.source ?? "manual" }] : []));
      return buildWeeklySummary(rows, new Date(), { partial: rows.length >= ROW_CAP });
    },
    enabled: !!patientId,
  });
}

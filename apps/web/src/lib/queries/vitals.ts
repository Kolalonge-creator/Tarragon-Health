import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function useVitalsReadings(patientId: string) {
  return useQuery({
    queryKey: ["vitals-readings", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select("*")
        .eq("patient_id", patientId)
        .order("taken_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

const TREND_WINDOW_DAYS = 90;

/** Ascending-order readings for charting (opposite of useVitalsReadings's
 * newest-first list order — a trend chart reads left to right). */
export function useVitalsTrend(patientId: string, vitalType: "blood_pressure" | "glucose") {
  return useQuery({
    queryKey: ["vitals-trend", patientId, vitalType],
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select("taken_at, systolic, diastolic, glucose_mmol_l, glucose_context")
        .eq("patient_id", patientId)
        .eq("vital_type", vitalType)
        .gte("taken_at", since)
        .order("taken_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

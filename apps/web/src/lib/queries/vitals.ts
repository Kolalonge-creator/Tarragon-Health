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

export type VitalsTrendType = "blood_pressure" | "glucose" | "weight" | "pulse";

/** Ascending-order readings for charting (opposite of useVitalsReadings's
 * newest-first list order — a trend chart reads left to right). */
export function useVitalsTrend(patientId: string, vitalType: VitalsTrendType) {
  return useQuery({
    queryKey: ["vitals-trend", patientId, vitalType],
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select("taken_at, systolic, diastolic, glucose_mmol_l, glucose_context, weight_kg, pulse_bpm")
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

/** HbA1c is a lab-drawn value, not a self-logged vital (see
 * lab_analyte_readings' migration note) — checked every few months rather
 * than daily, so unlike BP/glucose this pulls full history with no
 * trailing-window cutoff, matching maybeComputeHba1cTrajectory's query in
 * screening-result-actions.ts. */
export function useHba1cTrend(patientId: string) {
  return useQuery({
    queryKey: ["hba1c-trend", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_analyte_readings")
        .select("taken_at, value")
        .eq("patient_id", patientId)
        .eq("code", "hba1c")
        .order("taken_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

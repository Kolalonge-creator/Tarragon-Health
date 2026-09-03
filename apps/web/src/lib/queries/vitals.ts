import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { computeBmi } from "@/lib/obesity/classify";
import { fetchHeightStatus, type HeightStatus } from "@/lib/health-metrics/height";

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
 * newest-first list order — a trend chart reads left to right). `windowDays`
 * overrides the default 90-day cutoff — used by the weight-goal card's
 * Week/Month/All-time toggle; every other caller keeps the default. */
export function useVitalsTrend(
  patientId: string,
  vitalType: VitalsTrendType,
  windowDays: number = TREND_WINDOW_DAYS,
) {
  return useQuery({
    queryKey: ["vitals-trend", patientId, vitalType, windowDays],
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
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

/** Most recent logged weight, for the weight-goal card's "current weight"
 * figure — cheaper than pulling the whole trend just for the last point. */
export function useLatestWeightKg(patientId: string) {
  return useQuery({
    queryKey: ["latest-weight-kg", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select("weight_kg, taken_at")
        .eq("patient_id", patientId)
        .eq("vital_type", "weight")
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

/** Reconciles profiles.height_cm against the latest risk-assessment answer
 * (see lib/health-metrics/height.ts) — the canonical height for BMI, plus a
 * discrepancy the vitals page should prompt the patient to resolve. */
export function useHeightStatus(patientId: string) {
  return useQuery({
    queryKey: ["height-status", patientId],
    queryFn: async (): Promise<HeightStatus> => {
      const supabase = createClient();
      return fetchHeightStatus(supabase, patientId);
    },
    enabled: !!patientId,
  });
}

export type BmiTrendPoint = { taken_at: string; weight_kg: number; bmi: number };

/** BMI has no reading of its own — each logged weight is combined with the
 * patient's current height (see useHeightStatus) to derive a point. Height
 * is applied retroactively across the whole series rather than tracked
 * per-point, since adult height changes rarely. Returns [] (not an error)
 * when no height is on file yet — callers should check useHeightStatus to
 * tell that apart from "no weight readings". */
export function useBmiTrend(patientId: string, windowDays: number = TREND_WINDOW_DAYS) {
  return useQuery({
    queryKey: ["bmi-trend", patientId, windowDays],
    queryFn: async (): Promise<BmiTrendPoint[]> => {
      const supabase = createClient();
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: weightRows, error: weightError }, heightStatus] = await Promise.all([
        supabase
          .from("vitals_readings")
          .select("taken_at, weight_kg")
          .eq("patient_id", patientId)
          .eq("vital_type", "weight")
          .gte("taken_at", since)
          .order("taken_at", { ascending: true }),
        fetchHeightStatus(supabase, patientId),
      ]);
      if (weightError) throw weightError;

      const heightCm = heightStatus.heightCm;
      if (!heightCm) return [];

      return (weightRows ?? []).flatMap((row) => {
        const rawBmi = row.weight_kg != null ? computeBmi(row.weight_kg, heightCm) : null;
        // Round to 1dp at the source (matches the "Latest: 24.2" display) —
        // weight/height² otherwise carries long floating-point tails (e.g.
        // 24.221453287197235) that leak into the chart's auto-generated
        // Y-axis ticks, unlike every other trend series here whose readings
        // are already 1-2dp as entered.
        const bmi = rawBmi != null ? Math.round(rawBmi * 10) / 10 : null;
        return bmi != null ? [{ taken_at: row.taken_at, weight_kg: row.weight_kg as number, bmi }] : [];
      });
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

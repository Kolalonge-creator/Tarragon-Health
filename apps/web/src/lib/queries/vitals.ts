import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { computeBmi } from "@/lib/obesity/classify";

/** Per-scheduled-vital expected/completed/missed/adherence% over a rolling
 * window (§6.13) — see public.patient_vitals_adherence(). Empty array (not
 * an error) for a patient with no active monitoring_schedule_items, e.g.
 * nobody enrolled in a chronic programme yet. */
export function useVitalsAdherence(patientId: string, windowDays = 28) {
  return useQuery({
    queryKey: ["vitals-adherence", patientId, windowDays],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("patient_vitals_adherence", {
        p_patient_id: patientId,
        p_window_days: windowDays,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

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
/** Readings a clinician should give a second look (§6.6/§6.7) — flagged by
 * private.flag_vitals_requiring_validation() at insert, never a value the
 * platform simply discarded. */
export function useFlaggedVitalsReadings(patientId: string) {
  return useQuery({
    queryKey: ["flagged-vitals-readings", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select("*")
        .eq("patient_id", patientId)
        .eq("validation_status", "requires_validation")
        .order("taken_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

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

/** Latest patient-reported height — vitals_readings has no height column, so
 * BMI's other half lives in the risk assessment's height_cm question (same
 * source fetchLatestBmi in lib/health-metrics/bmi.ts reads). */
export function useLatestHeightCm(patientId: string) {
  return useQuery({
    queryKey: ["latest-height-cm", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("risk_assessment_responses")
        .select("response")
        .eq("profile_id", patientId)
        .eq("question_key", "height_cm")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return typeof data?.response === "number" ? data.response : null;
    },
    enabled: !!patientId,
  });
}

export type BmiTrendPoint = { taken_at: string; weight_kg: number; bmi: number };

/** BMI has no reading of its own — each logged weight is combined with the
 * patient's current height to derive a point. Height is applied
 * retroactively across the whole series rather than tracked per-point,
 * since risk_assessment_responses only ever keeps the latest answer and
 * adult height changes rarely; same approach as fetchLatestBmi's single-point
 * version, extended into a series for charting. Returns [] (not an error)
 * when no height is on file yet — callers should check useLatestHeightCm to
 * tell that apart from "no weight readings". */
export function useBmiTrend(patientId: string, windowDays: number = TREND_WINDOW_DAYS) {
  return useQuery({
    queryKey: ["bmi-trend", patientId, windowDays],
    queryFn: async (): Promise<BmiTrendPoint[]> => {
      const supabase = createClient();
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: weightRows, error: weightError }, { data: heightRow, error: heightError }] =
        await Promise.all([
          supabase
            .from("vitals_readings")
            .select("taken_at, weight_kg")
            .eq("patient_id", patientId)
            .eq("vital_type", "weight")
            .gte("taken_at", since)
            .order("taken_at", { ascending: true }),
          supabase
            .from("risk_assessment_responses")
            .select("response")
            .eq("profile_id", patientId)
            .eq("question_key", "height_cm")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      if (weightError) throw weightError;
      if (heightError) throw heightError;

      const heightCm = typeof heightRow?.response === "number" ? heightRow.response : null;
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

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { computeBmi } from "@/lib/obesity/classify";
import { fetchHeightStatus, type HeightStatus } from "@/lib/health-metrics/height";
import { readPatientVitalsOrThrow } from "@/lib/clinical/vitals-audited";

export function useVitalsReadings(patientId: string) {
  return useQuery({
    queryKey: ["vitals-readings", patientId],
    queryFn: async () => {
      // INV-10: staff read vitals through the audited, tie-gated function; a refusal throws, never "no readings".
      return readPatientVitalsOrThrow(createClient(), patientId, { limit: 20 });
    },
    // Each staff read writes an audit row: no refetch on focus, no retry of a refusal.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!patientId,
  });
}

const VITALS_HISTORY_PAGE_SIZE = 10;

/** Paginated "Recent readings" list (10 at a time, "Load more" per click) —
 * distinct from useVitalsReadings above (a fixed top-20 snapshot other
 * callers, like the risk-assessment form, read as a plain array). */
export function useVitalsReadingsPage(patientId: string) {
  return useInfiniteQuery({
    queryKey: ["vitals-readings-page", patientId],
    queryFn: async ({ pageParam }) => {
      const rows = await readPatientVitalsOrThrow(createClient(), patientId, {
        limit: VITALS_HISTORY_PAGE_SIZE,
        offset: pageParam * VITALS_HISTORY_PAGE_SIZE,
      });
      return { rows, hasMore: rows.length === VITALS_HISTORY_PAGE_SIZE };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length : undefined),
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
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const rows = await readPatientVitalsOrThrow(createClient(), patientId, { vitalType, since, ascending: true, limit: 1000 });
      return rows.map((r) => ({
        taken_at: r.taken_at,
        systolic: r.systolic,
        diastolic: r.diastolic,
        glucose_mmol_l: r.glucose_mmol_l,
        glucose_context: r.glucose_context,
        weight_kg: r.weight_kg,
        pulse_bpm: r.pulse_bpm,
      }));
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!patientId,
  });
}

/** Most recent logged weight, for the weight-goal card's "current weight"
 * figure — cheaper than pulling the whole trend just for the last point. */
export function useLatestWeightKg(patientId: string) {
  return useQuery({
    queryKey: ["latest-weight-kg", patientId],
    queryFn: async () => {
      const rows = await readPatientVitalsOrThrow(createClient(), patientId, { vitalType: "weight", limit: 1 });
      const latest = rows[0];
      return latest ? { weight_kg: latest.weight_kg, taken_at: latest.taken_at } : null;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
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
      const [weightRows, heightStatus] = await Promise.all([
        readPatientVitalsOrThrow(supabase, patientId, { vitalType: "weight", since, ascending: true, limit: 1000 }),
        fetchHeightStatus(supabase, patientId),
      ]);

      const heightCm = heightStatus.heightCm;
      if (!heightCm) return [];

      return weightRows.flatMap((row) => {
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

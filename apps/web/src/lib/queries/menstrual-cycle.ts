import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";
import { lagosDateString } from "@/lib/ai-coach/lagos-day";
import {
  predictCycle,
  type CyclePrediction,
  type ObservedPeriod,
  type ReproductiveLifeStage,
} from "@/lib/rules/cycle-prediction";

export type MenstrualCycle = Tables<"menstrual_cycles">;
export type MenstrualDailyLog = Tables<"menstrual_daily_logs">;
export type MenstrualFlowLevel = Enums<"menstrual_flow_level">;
export type MenstrualSymptom = Enums<"menstrual_symptom">;
export type MenstrualMood = Enums<"menstrual_mood">;

/**
 * How far back the tracker reads. Two years comfortably covers the six
 * cycles the prediction engine uses plus enough history for the calendar to
 * page back through, without pulling a decade of rows into the browser.
 */
const HISTORY_WINDOW_DAYS = 730;

function cyclesKey(patientId: string) {
  return ["menstrual-cycles", patientId];
}
function logsKey(patientId: string) {
  return ["menstrual-daily-logs", patientId];
}

function windowStart(): string {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - HISTORY_WINDOW_DAYS);
  return start.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Observed bleeding episodes, most recent first. */
export function useMenstrualCycles(patientId: string) {
  return useQuery({
    queryKey: cyclesKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("menstrual_cycles")
        .select("*")
        .eq("patient_id", patientId)
        .gte("period_start_date", windowStart())
        .order("period_start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MenstrualCycle[];
    },
    enabled: !!patientId,
  });
}

/** Daily flow/symptom/mood logs, most recent first. */
export function useMenstrualDailyLogs(patientId: string) {
  return useQuery({
    queryKey: logsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("menstrual_daily_logs")
        .select("*")
        .eq("patient_id", patientId)
        .gte("log_date", windowStart())
        .order("log_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MenstrualDailyLog[];
    },
    enabled: !!patientId,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface LogPeriodInput {
  patientId: string;
  organisationId: string;
  periodStartDate: string;
  periodEndDate?: string | null;
  notes?: string | null;
}

/**
 * Records the start of a period, or corrects one already logged for the same
 * day. Upserting on (patient_id, period_start_date) rather than plain
 * inserting is what makes the "I started today" button idempotent: a second
 * tap updates the same row instead of creating a duplicate that the engine
 * would have to read as a zero-day cycle.
 */
export function useLogPeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LogPeriodInput) => {
      // Defence in depth behind the disabled button in cycle-tracker. A
      // future-dated period start is never a real observation, and once
      // inserted it silently corrupts every cycle length, prediction and
      // clinical flag derived from it. Postgres cannot hold this as a CHECK
      // (current_date is not immutable), so it is asserted on both sides of
      // the call instead of neither.
      if (input.periodStartDate > lagosDateString()) {
        throw new Error("A period cannot be logged as starting in the future.");
      }
      const supabase = createClient();
      const { error } = await supabase.from("menstrual_cycles").upsert(
        {
          patient_id: input.patientId,
          organisation_id: input.organisationId,
          period_start_date: input.periodStartDate,
          period_end_date: input.periodEndDate ?? null,
          notes: input.notes ?? null,
        },
        { onConflict: "patient_id,period_start_date" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: cyclesKey(variables.patientId) });
    },
  });
}

/** Sets the end date on an open period ("my period has finished"). */
export function useEndPeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patientId: string; cycleId: string; endDate: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("menstrual_cycles")
        .update({ period_end_date: input.endDate })
        .eq("id", input.cycleId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: cyclesKey(variables.patientId) });
    },
  });
}

/**
 * Removes a mis-logged period. Deliberately supported: a wrong start date
 * does not just show a wrong row, it corrupts every cycle length derived
 * from it, so there has to be a way to take it back.
 */
export function useDeletePeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patientId: string; cycleId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("menstrual_cycles").delete().eq("id", input.cycleId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: cyclesKey(variables.patientId) });
    },
  });
}

export interface SaveDailyLogInput {
  patientId: string;
  organisationId: string;
  logDate: string;
  flow: MenstrualFlowLevel | null;
  symptoms: MenstrualSymptom[];
  moods: MenstrualMood[];
  notes?: string | null;
}

export function useSaveDailyLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveDailyLogInput) => {
      const supabase = createClient();
      const { error } = await supabase.from("menstrual_daily_logs").upsert(
        {
          patient_id: input.patientId,
          organisation_id: input.organisationId,
          log_date: input.logDate,
          flow: input.flow,
          symptoms: input.symptoms,
          moods: input.moods,
          notes: input.notes ?? null,
        },
        { onConflict: "patient_id,log_date" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: logsKey(variables.patientId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Composed read: history -> prediction
// ---------------------------------------------------------------------------

export interface UseCycleTrackerResult {
  cycles: MenstrualCycle[];
  dailyLogs: MenstrualDailyLog[];
  prediction: CyclePrediction;
  /** The open period, if the patient is currently bleeding and has not ended it. */
  openCycle: MenstrualCycle | null;
  today: string;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Single source of truth for everything the cycle UI renders: pulls the
 * history, hands it to the pure prediction engine, and memoises the result.
 *
 * `today` is resolved in Africa/Lagos, not UTC — see lagosDateString. Getting
 * that wrong would shift every cycle day by one for an hour each night.
 */
export function useCycleTracker(
  patientId: string,
  lifeStage: ReproductiveLifeStage,
  selfReportedCycleLengthDays: number | null
): UseCycleTrackerResult {
  const cyclesQuery = useMenstrualCycles(patientId);
  const logsQuery = useMenstrualDailyLogs(patientId);

  const cycles = useMemo(() => cyclesQuery.data ?? [], [cyclesQuery.data]);
  const dailyLogs = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);
  const today = lagosDateString();

  const prediction = useMemo(() => {
    const periods: ObservedPeriod[] = cycles.map((cycle) => ({
      startDate: cycle.period_start_date,
      endDate: cycle.period_end_date,
    }));
    const heavyFlowDates = dailyLogs
      .filter((log) => log.flow === "flooding")
      .map((log) => log.log_date);
    return predictCycle({
      periods,
      today,
      lifeStage,
      selfReportedCycleLengthDays,
      heavyFlowDates,
    });
  }, [cycles, dailyLogs, today, lifeStage, selfReportedCycleLengthDays]);

  // The most recent period counts as "open" only while it has no end date
  // AND started recently enough to still plausibly be running — otherwise a
  // period somebody forgot to close in March would still be offering an
  // "end my period" button in September.
  const openCycle = useMemo(() => {
    const latest = cycles[0];
    if (!latest || latest.period_end_date) return null;
    const daysSinceStart = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.period_start_date}T00:00:00Z`)) /
        86_400_000
    );
    return daysSinceStart >= 0 && daysSinceStart <= 14 ? latest : null;
  }, [cycles, today]);

  return {
    cycles,
    dailyLogs,
    prediction,
    openCycle,
    today,
    isLoading: cyclesQuery.isLoading || logsQuery.isLoading,
    error: (cyclesQuery.error as Error | null) ?? (logsQuery.error as Error | null),
  };
}

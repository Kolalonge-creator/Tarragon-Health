import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import { todayIsoDate } from "./medications";
import type { Enums, Tables } from "@tarragon/shared";
import {
  predictCycle,
  type CyclePrediction,
  type ObservedPeriod,
  type ReproductiveLifeStage,
} from "./cycle-prediction";

/**
 * Cycle tracker (spec §44's large sub-feature, formerly WebView-only —
 * see docs/mobile-native-conversion/womens-health.md) data layer. Mirrors
 * apps/web/src/lib/queries/menstrual-cycle.ts's read/write shapes exactly:
 * same tables, same columns, same filters, same upsert onConflict keys,
 * same 730-day history window. Duplicated rather than imported since
 * apps/web isn't a shared package the mobile app can pull from (same
 * convention as lib/medications.ts and lib/womens-health.ts) — keep in sync
 * if the web queries change.
 *
 * `menstrual_cycles`/`menstrual_daily_logs` are `reproductive_health`
 * category-scoped, protected tables (CLAUDE.md's standing reproductive-
 * health RLS rule) — verified live against `pg_policies` before writing
 * this file. Every function below is a PLAIN authenticated `supabase.from`
 * call with no service-role client and no hand-written access check; RLS
 * alone decides who can read or write which patient's rows, exactly like
 * useMenstrualCycles/useMenstrualDailyLogs do on web. `patientId` is always
 * the caller's already-resolved subjectId (home-shell passes
 * WomensHealthScreen the acting-for-aware subjectId, same as web's
 * getPatientDashboardContext) — this file introduces no new acting-for
 * path and no new RLS shape.
 */

export type MenstrualCycle = Tables<"menstrual_cycles">;
export type MenstrualDailyLog = Tables<"menstrual_daily_logs">;
export type MenstrualFlowLevel = Enums<"menstrual_flow_level">;
export type MenstrualSymptom = Enums<"menstrual_symptom">;
export type MenstrualMood = Enums<"menstrual_mood">;
export type MenstrualOvulationTestResult = Enums<"menstrual_ovulation_test_result">;

/** Mirrors HISTORY_WINDOW_DAYS on web — six cycles' worth of prediction
 * input plus enough history to browse, without pulling years of rows. */
const HISTORY_WINDOW_DAYS = 730;

function windowStart(): string {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - HISTORY_WINDOW_DAYS);
  return start.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Observed bleeding episodes, most recent first. */
export async function loadMenstrualCycles(patientId: string): Promise<QueryResult<MenstrualCycle[]>> {
  const { data, error } = await supabase
    .from("menstrual_cycles")
    .select("*")
    .eq("patient_id", patientId)
    .gte("period_start_date", windowStart())
    .order("period_start_date", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

/** Daily flow/symptom/mood logs, most recent first. */
export async function loadMenstrualDailyLogs(patientId: string): Promise<QueryResult<MenstrualDailyLog[]>> {
  const { data, error } = await supabase
    .from("menstrual_daily_logs")
    .select("*")
    .eq("patient_id", patientId)
    .gte("log_date", windowStart())
    .order("log_date", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
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
 * day. Upserting on (patient_id, period_start_date), same as web, so a
 * second "started today" tap updates the row instead of duplicating it.
 */
export async function logPeriod(input: LogPeriodInput): Promise<QueryResult<null>> {
  // Same defence-in-depth as web's useLogPeriod: a future-dated period start
  // is never a real observation and would silently corrupt every cycle
  // length/prediction/flag derived from it. Postgres cannot hold this as a
  // CHECK (current_date isn't immutable), so it is asserted here too.
  if (input.periodStartDate > todayIsoDate()) {
    return { ok: false, error: "A period cannot be logged as starting in the future." };
  }
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
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Sets the end date on an open period ("my period has finished"). */
export async function endPeriod(input: { cycleId: string; endDate: string }): Promise<QueryResult<null>> {
  const { error } = await supabase
    .from("menstrual_cycles")
    .update({ period_end_date: input.endDate })
    .eq("id", input.cycleId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/**
 * Removes a mis-logged period. A wrong start date does not just show a
 * wrong row, it corrupts every cycle length derived from it, so there has
 * to be a way to take it back — same as web's useDeletePeriod.
 */
export async function deletePeriod(cycleId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.from("menstrual_cycles").delete().eq("id", cycleId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export interface SaveDailyLogInput {
  patientId: string;
  organisationId: string;
  logDate: string;
  flow: MenstrualFlowLevel | null;
  symptoms: MenstrualSymptom[];
  moods: MenstrualMood[];
  notes?: string | null;
  /** Celsius, taken at rest before rising. */
  basalBodyTemperatureC?: number | null;
  ovulationTestResult?: MenstrualOvulationTestResult | null;
}

export async function saveDailyLog(input: SaveDailyLogInput): Promise<QueryResult<null>> {
  const { error } = await supabase.from("menstrual_daily_logs").upsert(
    {
      patient_id: input.patientId,
      organisation_id: input.organisationId,
      log_date: input.logDate,
      flow: input.flow,
      symptoms: input.symptoms,
      moods: input.moods,
      notes: input.notes ?? null,
      basal_body_temperature_c: input.basalBodyTemperatureC ?? null,
      ovulation_test_result: input.ovulationTestResult ?? null,
    },
    { onConflict: "patient_id,log_date" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Composed read: history -> prediction (mirrors web's useCycleTracker, minus
// the insights/thermal-shift add-ons which stay web-only for this pass)
// ---------------------------------------------------------------------------

export interface CycleTrackerData {
  cycles: MenstrualCycle[];
  dailyLogs: MenstrualDailyLog[];
  prediction: CyclePrediction;
  /** The open period, if the patient is currently bleeding and has not ended it. */
  openCycle: MenstrualCycle | null;
  today: string;
}

export async function loadCycleTracker(
  patientId: string,
  lifeStage: ReproductiveLifeStage,
  selfReportedCycleLengthDays: number | null
): Promise<QueryResult<CycleTrackerData>> {
  const [cyclesRes, logsRes] = await Promise.all([
    loadMenstrualCycles(patientId),
    loadMenstrualDailyLogs(patientId),
  ]);
  if (!cyclesRes.ok) return cyclesRes;
  if (!logsRes.ok) return logsRes;

  const cycles = cyclesRes.data;
  const dailyLogs = logsRes.data;
  const today = todayIsoDate();

  const periods: ObservedPeriod[] = cycles.map((cycle) => ({
    startDate: cycle.period_start_date,
    endDate: cycle.period_end_date,
  }));
  const heavyFlowDates = dailyLogs.filter((log) => log.flow === "flooding").map((log) => log.log_date);
  const prediction = predictCycle({
    periods,
    today,
    lifeStage,
    selfReportedCycleLengthDays,
    heavyFlowDates,
  });

  // Same "still plausibly running" rule as web: no end date AND started
  // within the last 14 days, so a period somebody forgot to close months
  // ago doesn't keep offering an "end my period" button forever.
  const latest = cycles[0] ?? null;
  let openCycle: MenstrualCycle | null = null;
  if (latest && !latest.period_end_date) {
    const daysSinceStart = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.period_start_date}T00:00:00Z`)) / 86_400_000
    );
    openCycle = daysSinceStart >= 0 && daysSinceStart <= 14 ? latest : null;
  }

  return { ok: true, data: { cycles, dailyLogs, prediction, openCycle, today } };
}

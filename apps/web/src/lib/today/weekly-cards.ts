import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnosticBpReadings, type Database } from "@tarragon/shared";
import { buildWeeklySummary, parseWeeklyConfig, type WeeklyInput, type WeeklySummary } from "@tarragon/clinical/today";
import { addDays, lagosLocalDate } from "@tarragon/medicines";
import { loadAdherenceReport } from "@/lib/medicines/adherence-report-data";

/**
 * The weekly summary cards (S47b, v5 4.5) for the signed-in person, read with her own session so row level security keeps every read to her own
 * data. Each figure comes from the place the rest of the platform already gets it: cuff readings and `my_home_bp_target()` for blood pressure,
 * `activity_week_progress()` for activity (S48a), the `food_logs` view for meals (S49a) and `loadAdherenceReport` for medicines (S08, the same
 * formula as the printed adherence report). This file only gathers them; the cards are built by the pure function in @tarragon/clinical.
 *
 * The answer is `hidden` (show nothing at all, no reason) until the Chief Medical Officer has signed the configuration. A source that fails is left
 * out of the summary rather than shown as a zero, so a card is never a statement about data that could not be read.
 */
export type WeeklyCardsResult = { state: "hidden" } | { state: "ready"; summary: WeeklySummary };

type Client = SupabaseClient<Database>;

interface TargetRow {
  systolic: number | null;
  diastolic: number | null;
}

export async function loadWeeklyCards(supabase: Client, patientId: string, nowMs: number = Date.now()): Promise<WeeklyCardsResult> {
  const cfgRes = await supabase.rpc("my_home_card_config");
  const raw = cfgRes.data as { config?: { weekly?: unknown } } | null;
  if (cfgRes.error || !raw?.config) return { state: "hidden" };
  let weekly;
  try {
    weekly = parseWeeklyConfig(raw.config.weekly);
  } catch {
    return { state: "hidden" };
  }

  const today = lagosLocalDate(nowMs);
  const sinceMs = Date.parse(`${addDays(today, -6)}T00:00:00Z`) - 3_600_000;

  const [bpRes, targetRes, activityRes, mealsRes, adherenceRes] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("systolic, diastolic, source, taken_at")
      .eq("patient_id", patientId)
      .eq("vital_type", "blood_pressure")
      .is("correction_status", null)
      .gte("taken_at", new Date(sinceMs).toISOString()),
    supabase.rpc("my_home_bp_target"),
    supabase.rpc("activity_week_progress"),
    supabase.from("food_logs").select("logged_at").eq("patient_id", patientId).gte("logged_at", new Date(sinceMs).toISOString()),
    loadAdherenceReport(supabase, patientId, nowMs),
  ]);

  const input: WeeklyInput = {
    bloodPressure: bpRes.error
      ? null
      : {
          readings: diagnosticBpReadings(bpRes.data ?? [])
            .filter((r): r is typeof r & { systolic: number; diastolic: number } => typeof r.systolic === "number" && typeof r.diastolic === "number")
            .map((r) => ({ systolic: r.systolic, diastolic: r.diastolic })),
          target: toTarget(targetRes.error ? null : (Array.isArray(targetRes.data) ? (targetRes.data[0] as TargetRow | undefined) : undefined)),
        },
    activity: toActivity(activityRes.error ? null : activityRes.data),
    meals: mealsRes.error ? null : { daysLogged: new Set((mealsRes.data ?? []).flatMap((m) => (m.logged_at ? [lagosLocalDate(Date.parse(m.logged_at))] : []))).size },
    medicines: adherenceRes.ok && adherenceRes.data.weeks[0] ? toMedicines(adherenceRes.data.weeks[0]) : null,
  };
  return { state: "ready", summary: buildWeeklySummary(weekly, input) };
}

type BpTarget = { systolicBelow: number; diastolicBelow: number } | null;

function toTarget(row: TargetRow | null | undefined): BpTarget {
  if (!row || typeof row.systolic !== "number" || typeof row.diastolic !== "number") return null;
  return { systolicBelow: row.systolic, diastolicBelow: row.diastolic };
}

function toActivity(data: unknown): WeeklyInput["activity"] {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const w = data as { active_minutes?: unknown; weekly_active_minutes_goal?: unknown };
  return typeof w.active_minutes === "number" && typeof w.weekly_active_minutes_goal === "number"
    ? { activeMinutes: w.active_minutes, goalMinutes: w.weekly_active_minutes_goal }
    : null;
}

function toMedicines(week: { due: number; markedTaken: number; percent: number | null }): WeeklyInput["medicines"] {
  return { due: week.due, markedTaken: week.markedTaken, percent: week.percent };
}

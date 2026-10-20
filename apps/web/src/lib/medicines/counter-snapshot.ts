import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { AdherenceReportWeek } from "@tarragon/medicines";
import { loadAdherenceReport } from "./adherence-report-data";

/**
 * The pharmacy-counter adherence view (follow-up to S08x/S09x): the patient's weekly "doses you marked taken" figures, frozen into a short-lived
 * record share (migration pharmacy_counter_adherence_snapshot). The figures come from `loadAdherenceReport`, the SAME function as the patient's
 * own report page and PDF (which uses `buildAdherenceReport` from @tarragon/medicines, the formula the app and the care team's chart use), so a
 * pharmacist and the patient never see two different numbers. Self-report only: no grade, skipped doses shown apart, no medicine name here.
 */
export const COUNTER_WEEKS = 4;

export type CounterWeek = {
  week_start: string;
  week_end: string;
  due: number;
  marked_taken: number;
  late: number;
  skipped: number;
  no_record: number;
  could_not_get: number;
  percent: number | null;
};

/** Exactly the keys the database accepts, newest week first, the most recent `COUNTER_WEEKS`. */
export function weeksForCounter(weeks: readonly AdherenceReportWeek[]): CounterWeek[] {
  return weeks.slice(0, COUNTER_WEEKS).map((w) => ({
    week_start: w.weekStart,
    week_end: w.weekEnd,
    due: w.due,
    marked_taken: w.markedTaken,
    late: w.late,
    skipped: w.skipped,
    no_record: w.noRecord,
    could_not_get: w.couldNotGet,
    percent: w.percent,
  }));
}

export type CounterResult =
  | { ok: true; token: string; pin: string; expiresAt: string }
  | { ok: false; reason: "closed" | "no_doses" | "too_many" | "report_failed" | "failed" };

export async function createCounterSnapshot(
  supabase: SupabaseClient<Database>,
  patientId: string,
  hours: number,
  nowMs: number = Date.now(),
): Promise<CounterResult> {
  const report = await loadAdherenceReport(supabase, patientId, nowMs);
  if (!report.ok) return { ok: false, reason: "report_failed" };
  // Nothing due in the weeks actually sent, nothing to show: never hand out a PIN for an empty sheet.
  const weeks = weeksForCounter(report.data.weeks);
  if (!weeks.some((w) => w.due > 0)) return { ok: false, reason: "no_doses" };

  const { data, error } = await supabase.rpc("create_pharmacy_counter_snapshot", {
    p_weeks: weeks,
    p_min_doses: report.data.minDoses,
    p_expires_in_hours: hours,
  });
  if (error) {
    if (error.code === "55000") return { ok: false, reason: "closed" };
    if (error.code === "53400") return { ok: false, reason: "too_many" };
    return { ok: false, reason: "failed" };
  }
  const body = data as { token?: unknown; pin?: unknown; expires_at?: unknown } | null;
  if (!body || typeof body.token !== "string" || typeof body.pin !== "string" || typeof body.expires_at !== "string") return { ok: false, reason: "failed" };
  return { ok: true, token: body.token, pin: body.pin, expiresAt: body.expires_at };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";

/**
 * A patient's weekly adherence for the clinician chart, through the tie-gated,
 * audited read (INV-10, INV-12). The figure is doses the patient marked taken over
 * doses due in the last seven Lagos days (docs/research/S08.md section 2), not a
 * clinical proportion of days covered: there is no dispensing data. A refusal or an
 * error must show as "not available", never as a figure or as "no data".
 *
 * No `server-only` import on purpose, same as dose-log.ts.
 */
export interface WeeklyAdherence {
  /** Null when too few doses were due to say anything fair. */
  percent: number | null;
  due: number;
  taken: number;
  late: number;
  skipped: number;
  missed: number;
  unavailable: number;
  belowThreshold: boolean;
  thresholdPercent: number;
  windowStart: string;
  windowEnd: string;
}

export type WeeklyAdherenceResult =
  | { status: "ok"; adherence: WeeklyAdherence }
  | { status: "denied" }
  | { status: "error"; message: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Turns the RPC's response into a result; a malformed response is an error, never zeros. */
export function parseWeeklyAdherencePayload(data: unknown): WeeklyAdherenceResult {
  const p = data as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return { status: "error", message: "unexpected adherence response" };
  if (p.status === "denied") return { status: "denied" };
  const due = num(p.due);
  const taken = num(p.taken);
  const late = num(p.late);
  const skipped = num(p.skipped);
  const missed = num(p.missed);
  const unavailable = num(p.unavailable);
  const threshold = num(p.threshold_percent);
  const percent = p.percent === null ? null : num(p.percent);
  if (
    p.status !== "ok" ||
    due === null ||
    taken === null ||
    late === null ||
    skipped === null ||
    missed === null ||
    unavailable === null ||
    threshold === null ||
    (p.percent !== null && percent === null) ||
    typeof p.window_start !== "string" ||
    typeof p.window_end !== "string" ||
    typeof p.below_threshold !== "boolean"
  ) {
    return { status: "error", message: "unexpected adherence response" };
  }
  return {
    status: "ok",
    adherence: {
      percent,
      due,
      taken,
      late,
      skipped,
      missed,
      unavailable,
      belowThreshold: p.below_threshold,
      thresholdPercent: threshold,
      windowStart: p.window_start,
      windowEnd: p.window_end,
    },
  };
}

export async function readWeeklyAdherence(
  supabase: SupabaseClient<Database>,
  patientId: string,
  reason: string = ROUTINE_CHART_READ_REASON,
): Promise<WeeklyAdherenceResult> {
  const { data, error } = await supabase.rpc("medication_weekly_adherence", { p_patient: patientId, p_reason: reason });
  if (error) return { status: "error", message: error.message };
  return parseWeeklyAdherencePayload(data);
}

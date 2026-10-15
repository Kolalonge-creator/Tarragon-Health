import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";

/**
 * The as-needed limits a clinician has set for a patient, and how many doses were over them in the last 7 days
 * (S08x, decision C7), through the tie-gated, audited read. A refusal or an error must show as "not available",
 * never as "no limits set" or "no flagged doses": a silent empty would read as reassurance.
 */
export interface PrnLimitRow {
  medicationId: string;
  minGapMinutes: number | null;
  dailyMax: number | null;
  setAt: string;
}
export interface PrnFlagCount {
  medicationId: string;
  doses: number;
}
export type PrnOverviewResult =
  | { status: "ok"; limits: PrnLimitRow[]; flagged: PrnFlagCount[] }
  | { status: "denied" }
  | { status: "error"; message: string };

const MALFORMED: PrnOverviewResult = { status: "error", message: "unexpected as-needed limits response" };

export function parsePrnOverviewPayload(data: unknown): PrnOverviewResult {
  const p = data as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return MALFORMED;
  if (p.status === "denied") return { status: "denied" };
  if (p.status !== "ok" || !Array.isArray(p.limits) || !Array.isArray(p.flagged_last_7_days)) return MALFORMED;
  const limits: PrnLimitRow[] = [];
  for (const raw of p.limits) {
    const l = raw as Record<string, unknown>;
    const gap = l.min_gap_minutes === null ? null : l.min_gap_minutes;
    const max = l.daily_max === null ? null : l.daily_max;
    if (typeof l.medication_id !== "string" || typeof l.set_at !== "string") return MALFORMED;
    if ((gap !== null && typeof gap !== "number") || (max !== null && typeof max !== "number")) return MALFORMED;
    limits.push({ medicationId: l.medication_id, minGapMinutes: gap as number | null, dailyMax: max as number | null, setAt: l.set_at });
  }
  const flagged: PrnFlagCount[] = [];
  for (const raw of p.flagged_last_7_days) {
    const f = raw as Record<string, unknown>;
    if (typeof f.medication_id !== "string" || typeof f.doses !== "number") return MALFORMED;
    flagged.push({ medicationId: f.medication_id, doses: f.doses });
  }
  return { status: "ok", limits, flagged };
}

export async function readPrnOverview(
  supabase: SupabaseClient<Database>,
  patientId: string,
  reason: string = ROUTINE_CHART_READ_REASON,
): Promise<PrnOverviewResult> {
  const { data, error } = await supabase.rpc("medication_prn_overview", { p_patient: patientId, p_reason: reason });
  if (error) return { status: "error", message: error.message };
  return parsePrnOverviewPayload(data);
}

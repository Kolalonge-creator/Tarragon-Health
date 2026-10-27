import type { SupabaseClient } from "@supabase/supabase-js";
import { getProposedConfig, type Database } from "@tarragon/shared";
import { computeBpControlRate, type BpControlRate, type ControlGateRule, type ControlReading } from "@tarragon/clinical";
import { readPatientVitalsAudited } from "./vitals-audited";

/**
 * The home blood pressure control rate for the clinician's chart (S07x follow-up): the share of the patient's home readings over the
 * last `PERIOD_DAYS` days that were inside the patient's own target. Descriptive only. Labelled as home readings, never a diagnosis.
 *
 * Reads go through the audited, tie-gated vitals function (a refusal is `denied`, never "no readings"), and the target through
 * `hbpm_summary` (the care team's target, or the standard starting target, with its source). The gate is the existing `bp.average_gate`:
 * below it the result carries only a count.
 */
export const CONTROL_PERIOD_DAYS = 30;

export type ControlRateResult =
  | { status: "ok"; rate: BpControlRate; target: { systolic: number; diastolic: number; source: string } }
  | { status: "denied" }
  | { status: "error"; message: string };

interface GateConfig {
  rules: ControlGateRule[];
}

export function averageGateRules(): ControlGateRule[] {
  const v = getProposedConfig("bp.average_gate").value as unknown as GateConfig;
  if (!Array.isArray(v.rules) || v.rules.length === 0) throw new Error("Config bp.average_gate has no rules");
  return v.rules;
}

export function minGapMinutes(): number {
  const v = getProposedConfig("bp.home_protocol").value as { minGapMinutes?: unknown };
  return typeof v.minGapMinutes === "number" && v.minGapMinutes >= 0 ? v.minGapMinutes : 1;
}

export async function loadBpControlRate(
  supabase: SupabaseClient<Database>,
  patientId: string,
  nowMs: number = Date.now(),
): Promise<ControlRateResult> {
  const since = new Date(nowMs - (CONTROL_PERIOD_DAYS + 1) * 86_400_000).toISOString();
  const [vitals, summary] = await Promise.all([
    readPatientVitalsAudited(supabase, patientId, { vitalType: "blood_pressure", since, limit: 1000, ascending: true }),
    supabase.rpc("hbpm_summary", { p_patient: patientId }),
  ]);
  if (vitals.status === "denied") return { status: "denied" };
  if (vitals.status === "error") return { status: "error", message: vitals.message };
  if (summary.error) return { status: "error", message: summary.error.message };
  const target = (summary.data as { target?: { systolic?: unknown; diastolic?: unknown; source?: unknown } } | null)?.target;
  if (!target || typeof target.systolic !== "number" || typeof target.diastolic !== "number") {
    return { status: "error", message: "no blood pressure target available" };
  }

  const readings: ControlReading[] = vitals.rows.flatMap((row) =>
    typeof row.systolic === "number" && typeof row.diastolic === "number" && row.taken_at
      ? [{ systolic: row.systolic, diastolic: row.diastolic, atMs: Date.parse(row.taken_at) }]
      : [],
  );
  const rate = computeBpControlRate({
    readings,
    target: { systolicBelow: target.systolic, diastolicBelow: target.diastolic },
    gateRules: averageGateRules(),
    nowMs,
    periodDays: CONTROL_PERIOD_DAYS,
    minGapMinutes: minGapMinutes(),
  });
  return { status: "ok", rate, target: { systolic: target.systolic, diastolic: target.diastolic, source: String(target.source ?? "") } };
}

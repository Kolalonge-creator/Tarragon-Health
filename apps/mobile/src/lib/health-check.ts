import { supabase } from "./supabase";
import { postConfirmHealthCheckVideoSlot } from "./api";
import type { QueryResult } from "./medications";
import type { Enums } from "@tarragon/shared";

/**
 * Mirrors apps/web/src/lib/screening/health-check-stage-state.ts verbatim —
 * pure functions, same fail-safe "neutral vs. done vs. todo" semantics.
 * `screeningsDue`/`riskCount` are exact counts, not booleans, on purpose: a
 * count that failed to come back must read as neutral, never as a to-do.
 */
export type HealthCheckStageState =
  | { kind: "done"; label: string }
  | { kind: "todo"; label: string }
  | { kind: "neutral"; label: string };

export function screeningStageState({
  riskCount,
  screeningsDue,
}: {
  riskCount: number | null | undefined;
  screeningsDue: number | null | undefined;
}): HealthCheckStageState {
  if (screeningsDue === null || screeningsDue === undefined || riskCount === null || riskCount === undefined) {
    return { kind: "neutral", label: "We could not check your screenings just now. Please refresh and try again." };
  }
  if (riskCount === 0) {
    return { kind: "neutral", label: "Not scheduled yet. Finish your health profile and we'll build your screening plan." };
  }
  if (screeningsDue === 0) {
    return { kind: "done", label: "Up to date" };
  }
  return { kind: "todo", label: `${screeningsDue} screening${screeningsDue === 1 ? "" : "s"} due, book now` };
}

export function countStageState({
  count,
  doneLabel,
  todoLabel,
  unknownLabel,
}: {
  count: number | null | undefined;
  doneLabel: string;
  todoLabel: string;
  unknownLabel: string;
}): HealthCheckStageState {
  if (count === null || count === undefined) return { kind: "neutral", label: unknownLabel };
  return count > 0 ? { kind: "done", label: doneLabel } : { kind: "todo", label: todoLabel };
}

const REQUIRED_SINGLE_VITALS = ["weight", "waist_circumference", "pulse"] as const;
const MIN_BP_READINGS = 2;
const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "blood pressure",
  weight: "weight",
  waist_circumference: "waist circumference",
  pulse: "pulse",
};

export interface HealthCheckVideoConsult {
  id: string;
  proposedSlots: string[] | null;
  scheduledAt: string | null;
  joinUrl: string | null;
}

export interface HealthCheckState {
  year: number;
  tierName: string | null;
  reviewedAt: string | null;
  reviewSummary: string | null;
  reviewerName: string | null;
  videoConsult: HealthCheckVideoConsult | null;
  stages: { title: string; state: HealthCheckStageState["kind"]; label: string }[];
}

/**
 * Mirrors apps/web/.../patient/health-check/page.tsx's data assembly
 * verbatim: opens this year's check (idempotent RPC), then reads
 * annual_health_checks (joined panel_bundle name + video_consult),
 * prevention_risk_scores/mental_health_screens counts, vitals_readings
 * since the check opened, screening_schedules count, and the reviewer's
 * name — all plain RLS-scoped reads, no service-role client.
 */
export async function loadHealthCheckState(patientId: string): Promise<QueryResult<HealthCheckState>> {
  await supabase.rpc("open_health_check");

  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01T00:00:00.000Z`;

  const { data: check, error: checkError } = await supabase
    .from("annual_health_checks")
    .select(
      "created_at, reviewed_at, reviewed_by, review_summary, status, lab_order_id, lab_order:lab_orders!annual_health_checks_lab_order_id_fkey(panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name)), video_consult:video_consultations!annual_health_checks_video_consultation_id_fkey(id, proposed_slots, scheduled_at, join_url)"
    )
    .eq("patient_id", patientId)
    .eq("year", year)
    .maybeSingle();
  if (checkError) return { ok: false, error: checkError.message };

  const vitalsWindowStart = check?.created_at ?? yearStart;

  const [
    { count: riskCount },
    { count: wellbeingCount },
    { data: vitalsRows, error: vitalsError },
    { count: screeningsDue },
  ] = await Promise.all([
    supabase.from("prevention_risk_scores").select("id", { count: "exact", head: true }).eq("profile_id", patientId),
    supabase
      .from("mental_health_screens")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .gte("created_at", yearStart),
    supabase.from("vitals_readings").select("vital_type").eq("patient_id", patientId).gte("taken_at", vitalsWindowStart),
    supabase
      .from("screening_schedules")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .in("status", ["pending", "overdue"]),
  ]);

  const vitalTypeCounts = (vitalsRows ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.vital_type] = (acc[row.vital_type] ?? 0) + 1;
    return acc;
  }, {});
  const bpCount = vitalTypeCounts.blood_pressure ?? 0;
  const missingVitalKinds = [
    ...(bpCount < MIN_BP_READINGS ? ["blood_pressure"] : []),
    ...REQUIRED_SINGLE_VITALS.filter((kind) => (vitalTypeCounts[kind] ?? 0) < 1),
  ];
  const vitalsComplete = missingVitalKinds.length === 0;

  let reviewerName: string | null = null;
  if (check?.reviewed_by) {
    const { data: reviewer } = await supabase
      .from("clinical_staff")
      .select("full_name")
      .eq("id", check.reviewed_by)
      .maybeSingle();
    reviewerName = reviewer?.full_name ? `Dr. ${reviewer.full_name}` : null;
  }

  const profileStage = countStageState({
    count: riskCount,
    doneLabel: "Completed",
    todoLabel: "Tell us your history and lifestyle",
    unknownLabel: "We could not check your health profile just now. Please refresh and try again.",
  });
  const wellbeingStage = countStageState({
    count: wellbeingCount,
    doneLabel: "Checked in this year",
    todoLabel: "A quick, private wellbeing check-in",
    unknownLabel: "We could not check this just now. Please refresh and try again.",
  });
  const screenings = screeningStageState({ riskCount, screeningsDue });

  const stages: HealthCheckState["stages"] = [
    { title: "1. Your health profile", state: profileStage.kind, label: profileStage.label },
    { title: "2. Mental wellbeing", state: wellbeingStage.kind, label: wellbeingStage.label },
    {
      title: "3. Your measurements",
      state: vitalsError ? "neutral" : vitalsComplete ? "done" : "todo",
      label: vitalsError
        ? "We could not check your readings just now. Please refresh and try again."
        : vitalsComplete
          ? "All readings logged for this check"
          : missingVitalKinds.length === 0
            ? "Log blood pressure (×2), weight, waist and pulse"
            : `Still need: ${missingVitalKinds
                .map((kind) => (kind === "blood_pressure" ? `blood pressure (${bpCount}/${MIN_BP_READINGS})` : VITAL_LABEL[kind]))
                .join(", ")}`,
    },
    { title: "4. Screenings", state: screenings.kind, label: screenings.label },
    { title: "5. Immunisations", state: "neutral", label: "Review the vaccines you're due" },
  ];

  const videoConsult: HealthCheckVideoConsult | null = check?.video_consult
    ? {
        id: check.video_consult.id,
        proposedSlots: check.video_consult.proposed_slots,
        scheduledAt: check.video_consult.scheduled_at,
        joinUrl: check.video_consult.join_url,
      }
    : null;

  return {
    ok: true,
    data: {
      year,
      tierName: check?.lab_order?.panel_bundle?.name ?? null,
      reviewedAt: check?.reviewed_at ?? null,
      reviewSummary: check?.review_summary ?? null,
      reviewerName,
      videoConsult,
      stages,
    },
  };
}

/** Mirrors health-check-video-consult-actions.ts's
 * confirmHealthCheckVideoConsultSlot — a real Zoom meeting + service-role
 * write + notification all happen server-side (see api.ts), this is a thin
 * passthrough, not a direct RPC call, even though the RPC alone is
 * technically callable. */
export async function confirmVideoSlot(consultId: string, slot: string): Promise<QueryResult<null>> {
  const result = await postConfirmHealthCheckVideoSlot(consultId, slot);
  if (result.error) return { ok: false, error: result.error };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Lipid profile (mirrors apps/web/src/lib/queries/lipids.ts +
// apps/web/src/lib/lipids/analytes.ts, ported verbatim — cholesterol is not
// a standalone feature, it's ordinary rows in the shared lab_analyte_readings
// store)
// ---------------------------------------------------------------------------

export const LIPID_ANALYTE_CODES = [
  "total_cholesterol",
  "ldl_cholesterol",
  "hdl_cholesterol",
  "triglycerides",
  "non_hdl_cholesterol",
] as const;

export type LipidAnalyteCode = (typeof LIPID_ANALYTE_CODES)[number];

export const LIPID_ANALYTE_META: Record<LipidAnalyteCode, { label: string; short: string; unit: string; computed?: boolean }> = {
  total_cholesterol: { label: "Total cholesterol", short: "Total", unit: "mg/dL" },
  ldl_cholesterol: { label: "LDL cholesterol", short: "LDL", unit: "mg/dL" },
  hdl_cholesterol: { label: "HDL cholesterol", short: "HDL", unit: "mg/dL" },
  triglycerides: { label: "Triglycerides", short: "Trig", unit: "mg/dL" },
  non_hdl_cholesterol: { label: "Non-HDL cholesterol", short: "Non-HDL", unit: "mg/dL", computed: true },
};

function computeNonHdl(total: number | null | undefined, hdl: number | null | undefined): number | null {
  if (total === null || total === undefined || hdl === null || hdl === undefined) return null;
  const value = total - hdl;
  return value >= 0 ? Math.round(value * 10) / 10 : null;
}

export interface LipidReading {
  code: LipidAnalyteCode;
  value: number;
  unit: string;
  takenAt: string;
}

export interface LipidProfile {
  latest: Partial<Record<LipidAnalyteCode, LipidReading>>;
  latestDrawnAt: string | null;
}

export async function loadLipidProfile(patientId: string): Promise<LipidProfile> {
  const { data } = await supabase
    .from("lab_analyte_readings")
    .select("code, value, unit, taken_at")
    .eq("patient_id", patientId)
    .in("code", LIPID_ANALYTE_CODES as unknown as string[])
    .order("taken_at", { ascending: true });

  const latest: Partial<Record<LipidAnalyteCode, LipidReading>> = {};
  let latestDrawnAt: string | null = null;

  for (const row of data ?? []) {
    const code = row.code as LipidAnalyteCode;
    if (!LIPID_ANALYTE_META[code]) continue;
    if (row.value === null || row.unit === null) continue;
    latest[code] = { code, value: Number(row.value), unit: row.unit, takenAt: row.taken_at };
    if (!latestDrawnAt || row.taken_at > latestDrawnAt) latestDrawnAt = row.taken_at;
  }

  // Non-HDL fallback for readings taken before it was persisted as its own row.
  if (!latest.non_hdl_cholesterol) {
    const fallback = computeNonHdl(latest.total_cholesterol?.value, latest.hdl_cholesterol?.value);
    if (fallback !== null && latestDrawnAt) {
      latest.non_hdl_cholesterol = { code: "non_hdl_cholesterol", value: fallback, unit: "mg/dL", takenAt: latestDrawnAt };
    }
  }

  return { latest, latestDrawnAt };
}

// ---------------------------------------------------------------------------
// Risk signals ("what your care team is watching") — mirrors
// apps/web/src/lib/queries/health-score.ts's usePatientRiskSignals +
// risk-signals-card.tsx's copy/gating, minus the AI explainer button
// (deferred, out of v1 per docs/mobile-native-conversion/health-check.md)
// ---------------------------------------------------------------------------

export const SCORE_TYPE_LABEL: Record<string, string> = {
  cvd_10yr: "Heart & circulation risk",
  hba1c_trajectory: "Blood sugar trend",
  bp_control: "Blood pressure control",
  heart_rate_pattern: "Heart rate pattern",
  predictive_missed_follow_up: "Staying on top of appointments",
};

/** Plain-language, non-alarmist gloss per risk_level — null for "low" means
 * a normal reading is never listed as something to worry about. */
export const RISK_LEVEL_COPY: Record<Enums<"risk_level">, string | null> = {
  low: null,
  moderate: "being watched a little more closely than usual",
  high: "getting extra attention from your care team",
  very_high: "a current focus for your care team",
  unknown: null,
};

export interface RiskSignal {
  scoreType: string;
  riskLevel: Enums<"risk_level">;
  computedAt: string;
}

export async function loadRiskSignals(patientId: string): Promise<RiskSignal[]> {
  const { data, error } = await supabase
    .from("patient_risk_scores")
    .select("score_type, risk_level, computed_at")
    .eq("patient_id", patientId)
    .neq("score_type", "health_score")
    .order("computed_at", { ascending: false });
  if (error || !data) return [];

  const latestByType = new Map<string, (typeof data)[number]>();
  for (const row of data) {
    if (!latestByType.has(row.score_type)) latestByType.set(row.score_type, row);
  }
  return [...latestByType.values()]
    .filter((row): row is typeof row & { risk_level: Enums<"risk_level"> } => row.risk_level != null)
    .map((row) => ({ scoreType: row.score_type, riskLevel: row.risk_level, computedAt: row.computed_at }));
}

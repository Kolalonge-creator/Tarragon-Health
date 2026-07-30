import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * The minimized, structured data a case brief is grounded in -- deliberately
 * NOT the patient's free-text clinical notes or full chart. Every field here
 * is something a doctor claiming this case would want at a glance; nothing
 * here is sent to Claude that isn't already visible elsewhere on this same
 * page (see case-brief-card.tsx). This shape is also stored verbatim as
 * case_briefs.input_snapshot, so it doubles as the audit record of what the
 * model actually saw.
 */
export interface CaseSnapshot {
  escalationReason: string;
  alert: { title: string; effectiveLevel: string; detail: string | null } | null;
  activeCarePlans: { condition: string }[];
  latestRiskScores: { scoreType: string; riskLevel: string | null; score: number | null }[];
  recentVitals: { vitalType: string; takenAt: string; values: Record<string, number | null> }[];
  recentEscalationHistory: { level: string | null; status: string; createdAt: string }[];
}

const VITAL_VALUE_FIELDS = [
  "systolic",
  "diastolic",
  "pulse_bpm",
  "glucose_mmol_l",
  "weight_kg",
  "spo2_pct",
  "temperature_c",
] as const;

/**
 * Best-effort snapshot -- never throws. A failed sub-query just leaves that
 * section empty; the brief generator degrades further from there (see
 * generate.ts), same "best-effort grounding" discipline as the AI Coach's
 * loadPatientContext.
 */
export async function buildCaseSnapshot(
  supabase: SupabaseClient<Database>,
  escalationId: string
): Promise<CaseSnapshot | null> {
  const { data: escalation } = await supabase
    .from("escalations")
    .select(
      "reason, patient_id, clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(title, detail, level, override_level)"
    )
    .eq("id", escalationId)
    .maybeSingle();

  if (!escalation) return null;

  const patientId = escalation.patient_id;

  const [{ data: carePlans }, { data: riskScores }, { data: vitals }, { data: history }] =
    await Promise.all([
      supabase.from("care_plans").select("condition").eq("patient_id", patientId).eq("status", "active"),
      supabase
        .from("patient_risk_scores")
        .select("score_type, risk_level, score")
        .eq("patient_id", patientId)
        .order("computed_at", { ascending: false })
        .limit(5),
      supabase
        .from("vitals_readings")
        .select(
          "vital_type, taken_at, systolic, diastolic, pulse_bpm, glucose_mmol_l, weight_kg, spo2_pct, temperature_c"
        )
        .eq("patient_id", patientId)
        .order("taken_at", { ascending: false })
        .limit(5),
      supabase
        .from("escalations")
        .select("status, created_at, clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(level)")
        .eq("patient_id", patientId)
        .neq("id", escalationId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const alert = escalation.clinician_alert;

  return {
    escalationReason: escalation.reason,
    alert: alert
      ? {
          title: alert.title,
          effectiveLevel: alert.override_level ?? alert.level,
          detail: alert.detail,
        }
      : null,
    activeCarePlans: (carePlans ?? []).map((c) => ({ condition: c.condition })),
    latestRiskScores: (riskScores ?? []).map((r) => ({
      scoreType: r.score_type,
      riskLevel: r.risk_level,
      score: r.score,
    })),
    recentVitals: (vitals ?? []).map((v) => {
      const numericFields: Record<(typeof VITAL_VALUE_FIELDS)[number], number | null> = {
        systolic: v.systolic,
        diastolic: v.diastolic,
        pulse_bpm: v.pulse_bpm,
        glucose_mmol_l: v.glucose_mmol_l,
        weight_kg: v.weight_kg,
        spo2_pct: v.spo2_pct,
        temperature_c: v.temperature_c,
      };
      return {
        vitalType: v.vital_type,
        takenAt: v.taken_at,
        values: Object.fromEntries(
          VITAL_VALUE_FIELDS.map((field) => [field, numericFields[field]]).filter(([, value]) => value !== null)
        ),
      };
    }),
    recentEscalationHistory: (history ?? []).map((h) => ({
      level: h.clinician_alert?.level ?? null,
      status: h.status,
      createdAt: h.created_at,
    })),
  };
}

/**
 * Renders a snapshot into the plain-text block the model sees. Pure and
 * deterministic so it's unit-testable without a live Supabase client or a
 * Claude call -- see generate.test.ts.
 */
export function formatSnapshotForPrompt(snapshot: CaseSnapshot): string {
  const lines: string[] = [];

  lines.push(`Escalation reason: ${snapshot.escalationReason}`);
  if (snapshot.alert) {
    lines.push(
      `Alert: ${snapshot.alert.title} (level: ${snapshot.alert.effectiveLevel})${
        snapshot.alert.detail ? ` -- ${snapshot.alert.detail}` : ""
      }`
    );
  }

  lines.push(
    snapshot.activeCarePlans.length > 0
      ? `Active care plans: ${snapshot.activeCarePlans.map((c) => c.condition).join(", ")}`
      : "Active care plans: none"
  );

  lines.push(
    snapshot.latestRiskScores.length > 0
      ? `Recent risk scores: ${snapshot.latestRiskScores
          .map((r) => `${r.scoreType}=${r.riskLevel ?? "unknown"}${r.score !== null ? ` (${r.score})` : ""}`)
          .join("; ")}`
      : "Recent risk scores: none on file"
  );

  lines.push(
    snapshot.recentVitals.length > 0
      ? `Recent vitals (most recent first): ${snapshot.recentVitals
          .map(
            (v) =>
              `${v.vitalType} on ${v.takenAt.slice(0, 10)}: ${Object.entries(v.values)
                .map(([k, val]) => `${k}=${val}`)
                .join(", ")}`
          )
          .join(" | ")}`
      : "Recent vitals: none on file"
  );

  lines.push(
    snapshot.recentEscalationHistory.length > 0
      ? `Recent escalation history: ${snapshot.recentEscalationHistory
          .map((h) => `${h.level ?? "unknown"} (${h.status}) on ${h.createdAt.slice(0, 10)}`)
          .join("; ")}`
      : "Recent escalation history: none"
  );

  return lines.join("\n");
}

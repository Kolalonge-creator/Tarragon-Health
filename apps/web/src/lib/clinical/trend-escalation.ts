import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { analyseRecord, describeForClinician, type TrendFinding } from "@/lib/rules/longitudinal";

const ALERT_TITLE_PREFIX = "Persistent trend";

// Already covered by lib/cv-risk/escalate.ts's flagCvRiskEscalations, which
// runs the config-driven CV-risk assessment (not a raw trend check alone)
// and separately queues a patient-facing nudge for a worsening lipid trend
// on treatment. Including these codes here too would double-alert the same
// signal through a second, less clinically-specific path.
const LIPID_FAMILY_CODES = new Set([
  "total_cholesterol",
  "ldl_cholesterol",
  "hdl_cholesterol",
  "triglycerides",
  "non_hdl_cholesterol",
]);

function codeTag(code: string): string {
  return `[trend_${code}]`;
}

/**
 * §7.7 "Trend-aware result interpretation" — a persistent, real movement
 * that has crossed (or stayed) outside the usual range for an analyte
 * prompts a clinician to review, even when no single reading in the run was
 * abnormal enough on its own to fire the classification-based abnormal-
 * result trigger (the HbA1c "6.8 -> 7.1 -> 7.8" example in the spec is
 * exactly this case). This never invents a new clinical threshold — it
 * only wires lib/rules/longitudinal.ts's existing, already-tuned
 * significance thresholds (previously display-only everywhere outside the
 * lipid pathway) into the closed loop.
 *
 * Only 'outside_range' findings escalate. 'notable' (a real, consistent
 * movement that is still inside the usual range) stays display-only, same
 * as everywhere else longitudinal.ts is used — escalating on a
 * still-in-range movement is exactly the "a false 'your kidney function is
 * worsening' is not a harmless error" case that engine's own header warns
 * against; the next reading will surface it anyway if it is genuine.
 *
 * Always level='clinician_review' with no sla_due_at — a prompt to review,
 * not an urgent escalation (the spec's own wording), same shape as
 * flagCvRiskEscalations' non-urgent rows. Idempotent per analyte (one open
 * alert per [trend_<code>] tag, mirroring flagCvRiskEscalations' own [code]
 * tag convention) and best-effort — callers must not let this block the
 * primary result recording.
 */
export async function flagTrendReviewEscalations(
  patientId: string,
  organisationId: string,
  sex: string | null
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: readings } = await supabase
    .from("lab_analyte_readings")
    .select("code, value, taken_at")
    .eq("patient_id", patientId)
    .order("taken_at", { ascending: true });

  // lab_analyte_readings also holds non-numeric results (genotype, malaria
  // film, urine dipstick) — value is null for those, excluded here same as
  // lib/clinical/patient-clinical-context.ts does.
  const eligibleReadings = (readings ?? []).filter(
    (r): r is typeof r & { value: number } => r.value !== null && !LIPID_FAMILY_CODES.has(r.code)
  );
  if (eligibleReadings.length === 0) return;

  const findings = analyseRecord(
    eligibleReadings.map((r) => ({ code: r.code, value: r.value, takenAt: r.taken_at })),
    { sex }
  ).filter((f) => f.significance === "outside_range");
  if (findings.length === 0) return;

  const { data: openAlerts } = await supabase
    .from("clinician_alerts")
    .select("detail")
    .eq("patient_id", patientId)
    .eq("status", "open")
    .ilike("title", `${ALERT_TITLE_PREFIX}%`);

  const openCodes = new Set(
    (openAlerts ?? [])
      .map((a) => /\[trend_([a-z0-9_]+)\]/.exec(a.detail ?? "")?.[1])
      .filter((c): c is string => Boolean(c))
  );

  const rows = findings
    .filter((f) => !openCodes.has(f.code))
    .map((f: TrendFinding) => ({
      organisation_id: organisationId,
      patient_id: patientId,
      level: "clinician_review" as const,
      escalation_level: 2,
      status: "open" as const,
      title: `${ALERT_TITLE_PREFIX}: ${f.label}`,
      detail: `${codeTag(f.code)} ${describeForClinician(f)}`,
    }));

  if (rows.length > 0) {
    await supabase.from("clinician_alerts").insert(rows);
  }
}

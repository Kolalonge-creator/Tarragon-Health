import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadCvRiskAssessment } from "@/lib/cv-risk/assess";
import type { CvRiskEscalation } from "@/lib/rules/cv-risk";
import { queueRiskSignalAttentionBestEffort } from "@/lib/notifications/queue-risk-signal-attention";

const ALERT_TITLE_PREFIX = "CV lipid risk";

// The only escalation code that becomes a patient-facing nudge — a rising
// Non-HDL trend is the one case that matches "your cholesterol has
// worsened" without putting a raw LDL/Non-HDL number or a statin-eligibility
// judgement over SMS. very_high_ldl/very_high_non_hdl/
// untreated_secondary_prevention stay clinician-only: those need a doctor's
// framing before a patient sees them.
const PATIENT_FACING_ESCALATION_CODE = "worsening_trend_on_treatment";

function codeTag(code: string): string {
  return `[${code}]`;
}

/**
 * After a lipid result is recorded, run the CV-risk assessment and raise a
 * clinician-review alert for each escalation — untreated high-risk/secondary
 * patients, very high LDL/Non-HDL, or a worsening trend despite treatment.
 *
 * This NEVER prescribes and never writes a medication; it only surfaces the
 * patient for a clinician's judgement, honouring the "flag for review, never
 * auto-treat" rule. Idempotent: it won't duplicate an already-open alert for
 * the same escalation code. Best-effort — callers must not let it block the
 * primary result recording.
 */
export async function flagCvRiskEscalations(
  patientId: string,
  organisationId: string
): Promise<void> {
  const supabase = createServiceRoleClient();

  const assessment = await loadCvRiskAssessment(supabase, patientId, organisationId);
  if (!assessment || assessment.escalations.length === 0) return;

  const { data: openAlerts } = await supabase
    .from("clinician_alerts")
    .select("detail")
    .eq("patient_id", patientId)
    .eq("status", "open")
    .ilike("title", `${ALERT_TITLE_PREFIX}%`);

  const openCodes = new Set(
    (openAlerts ?? [])
      .map((a) => /\[([a-z_]+)\]/.exec(a.detail ?? "")?.[1])
      .filter((c): c is string => Boolean(c))
  );

  const rows = assessment.escalations
    .filter((e) => !openCodes.has(e.code))
    .map((e: CvRiskEscalation) => ({
      organisation_id: organisationId,
      patient_id: patientId,
      level:
        e.severity === "urgent"
          ? ("urgent_escalation" as const)
          : ("clinician_review" as const),
      escalation_level: e.severity === "urgent" ? 3 : 2,
      status: "open" as const,
      title: `${ALERT_TITLE_PREFIX}: ${e.code.replace(/_/g, " ")}`,
      detail: `${codeTag(e.code)} ${e.label}`,
      // A worsening cardiovascular-risk trend is a clinical deterioration
      // signal (8.1 deterioration), not a single abnormal reading.
      category: "clinical" as const,
      type_code: "deterioration" as const,
    }));

  if (rows.length > 0) {
    await supabase.from("clinician_alerts").insert(rows);
  }

  const hasNewWorseningTrend = assessment.escalations.some(
    (e) => e.code === PATIENT_FACING_ESCALATION_CODE && !openCodes.has(e.code)
  );
  if (hasNewWorseningTrend) {
    await queueRiskSignalAttentionBestEffort(
      patientId,
      organisationId,
      "cv_risk_lipid_trend",
      "Cholesterol",
      "has moved in the wrong direction since your last check"
    );
  }
}

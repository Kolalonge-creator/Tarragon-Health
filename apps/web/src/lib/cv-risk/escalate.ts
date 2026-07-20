import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadCvRiskAssessment } from "@/lib/cv-risk/assess";
import type { CvRiskEscalation } from "@/lib/rules/cv-risk";

const ALERT_TITLE_PREFIX = "CV lipid risk";

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
    }));

  if (rows.length > 0) {
    await supabase.from("clinician_alerts").insert(rows);
  }
}

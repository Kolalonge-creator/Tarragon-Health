import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const ALERT_TITLE = "AUDIT-C: hazardous alcohol use flagged";

/**
 * Spec §18.10 — "referral to appropriate support when needed". AUDIT-C
 * scoring already exists (mental-health-actions.ts); this is the missing
 * piece the audit found — a hazardous score never routed anywhere. Mirrors
 * flagCvRiskEscalations (apps/web/src/lib/cv-risk/escalate.ts): raises a
 * clinician_alerts row, never auto-refers or auto-diagnoses. Idempotent —
 * won't duplicate an already-open alert. Best-effort, never blocks the
 * screen from saving.
 */
export async function flagHazardousAlcoholUse(
  patientId: string,
  organisationId: string,
  totalScore: number,
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: openAlert } = await supabase
    .from("clinician_alerts")
    .select("id")
    .eq("patient_id", patientId)
    .eq("status", "open")
    .eq("title", ALERT_TITLE)
    .maybeSingle();
  if (openAlert) return;

  await supabase.from("clinician_alerts").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    level: "clinician_review",
    escalation_level: 2,
    status: "open",
    title: ALERT_TITLE,
    detail: `AUDIT-C total ${totalScore} crossed the hazardous-use threshold — worth a conversation about support and reduction goals.`,
    category: "clinical",
    type_code: "symptom_escalation",
  });
}

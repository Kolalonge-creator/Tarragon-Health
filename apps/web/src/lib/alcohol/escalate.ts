import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * S56 (INV-07, INV-12): the alert names no instrument, score or alcohol wording. clinician_alerts is readable by every org staff
 * account and by a Care Circle supporter holding only 'medical_history', so a title like "AUDIT-C: hazardous alcohol use" would tell
 * them a person's alcohol screen result. The clinician who holds the task reads the screen through the audited path. The title is also
 * the de-duplication key, so it is distinct from the other neutral wellbeing titles.
 */
export const ALCOHOL_ALERT_TITLE = "A wellbeing support conversation is waiting";
export const ALCOHOL_ALERT_DETAIL = "Open the review from your task list. No score is shown here on purpose.";
const ALERT_TITLE = ALCOHOL_ALERT_TITLE;

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

  const { error } = await supabase.from("clinician_alerts").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    level: "clinician_review",
    escalation_level: 2,
    status: "open",
    title: ALERT_TITLE,
    detail: ALCOHOL_ALERT_DETAIL,
    category: "clinical",
    type_code: "symptom_escalation",
  });
  // Throw rather than discard: the caller reports it (a hazardous result that routed nowhere must be seen).
  if (error) throw new Error(`hazardous alcohol alert could not be raised: ${error.message}`);
}

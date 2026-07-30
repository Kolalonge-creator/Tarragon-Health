"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateCaseBrief } from "./generate";

/**
 * Generates (or regenerates) the AI-drafted case brief for a clinician
 * alert. Called automatically on acknowledge (useAcknowledgeAlert,
 * lib/queries/clinician-alerts.ts) and on claim (useClaimEscalation,
 * lib/queries/escalations.ts) -- same mechanism, two triggers, one brief
 * per alert. Also callable from the manual "Generate"/"Regenerate" control
 * on either worklist. RLS on the clinician_alerts read is the real gate
 * here -- a caller outside the org simply gets no alert back.
 */
export async function generateCaseBriefAction(clinicianAlertId: string): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const { data: alert } = await supabase
    .from("clinician_alerts")
    .select("organisation_id, patient_id")
    .eq("id", clinicianAlertId)
    .maybeSingle();
  if (!alert) return { success: false };

  // If this alert has already been escalated to a doctor, ground the brief
  // in the human-entered reason too -- optional, so a plain (not yet
  // escalated) clinician_alert generates just fine without it.
  const { data: escalation } = await supabase
    .from("escalations")
    .select("reason")
    .eq("clinician_alert_id", clinicianAlertId)
    .maybeSingle();

  const result = await generateCaseBrief(
    supabase,
    createServiceRoleClient,
    {
      clinicianAlertId,
      organisationId: alert.organisation_id,
      patientId: alert.patient_id,
    },
    escalation?.reason ?? null
  );
  return { success: result.status === "generated" };
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateCaseBrief } from "./generate";

/**
 * Generates (or regenerates) the AI-drafted case brief for an escalation.
 * Called automatically on claim (useClaimEscalation, lib/queries/escalations.ts)
 * and from the manual "Generate"/"Regenerate" control on the doctor escalation
 * detail page. RLS on the escalations read is the real gate here, same as the
 * detail page itself -- a caller outside the org simply gets no escalation back.
 */
export async function generateCaseBriefAction(escalationId: string): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const { data: escalation } = await supabase
    .from("escalations")
    .select("organisation_id, patient_id")
    .eq("id", escalationId)
    .maybeSingle();
  if (!escalation) return { success: false };

  const result = await generateCaseBrief(supabase, createServiceRoleClient, {
    escalationId,
    organisationId: escalation.organisation_id,
    patientId: escalation.patient_id,
  });
  return { success: result.status === "generated" };
}

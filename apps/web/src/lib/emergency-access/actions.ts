"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type EmergencyAccessActionResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

function revalidateEmergencyAccess() {
  revalidatePath("/clinician/emergency-access-review");
  revalidatePath("/clinician/patients", "layout");
}

/**
 * Requests time-boxed cross-organisation emergency access. The mandatory
 * reason and the cross-org check both live in request_emergency_record_access
 * itself — this action is a thin wrapper, not a second place those rules
 * could drift out of sync.
 */
export async function requestEmergencyAccessAction(
  patientId: string,
  reason: string
): Promise<EmergencyAccessActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_emergency_record_access", {
    p_patient_id: patientId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidateEmergencyAccess();
  return { ok: true, data };
}

/**
 * Records a review outcome. review_emergency_record_access() is where "a
 * different reviewer" and "the patient's home-org clinical director" are
 * actually enforced — same reason this is a thin wrapper, not a second
 * authorization check.
 */
export async function reviewEmergencyAccessAction(
  grantId: string,
  outcome: "reviewed_ok" | "reviewed_concern",
  note: string
): Promise<EmergencyAccessActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_emergency_record_access", {
    p_grant_id: grantId,
    p_outcome: outcome,
    p_note: note || undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidateEmergencyAccess();
  return { ok: true };
}

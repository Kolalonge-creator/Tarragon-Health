"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ReferPatientActionState = { error?: string; success?: boolean } | undefined;

const REFERRABLE_SPECIALIST_TYPES = new Set(["psychiatry", "psychology"]);

/**
 * Creates a psychiatry/psychology referral (Module 46 §46.8/§46.9) via the
 * public.refer_patient_to_specialist RPC — same clinical-staff/tier
 * authority check and insert shape as the existing consultation-follow-up
 * referral path, just reachable directly from a mental-health screen review
 * rather than requiring a prior consultation. Stays self_arranged by the
 * RPC's own default; this action never touches specialist matching/booking.
 */
export async function referPatientToSpecialist(
  patientId: string,
  _prev: ReferPatientActionState,
  formData: FormData,
): Promise<ReferPatientActionState> {
  const specialistType = formData.get("specialist_type");
  const reason = formData.get("reason");
  if (typeof specialistType !== "string" || !REFERRABLE_SPECIALIST_TYPES.has(specialistType)) {
    return { error: "Choose psychiatry or psychology" };
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return { error: "A referral needs a reason" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("refer_patient_to_specialist", {
    p_patient_id: patientId,
    p_specialist_type: specialistType,
    p_reason: reason.trim(),
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}

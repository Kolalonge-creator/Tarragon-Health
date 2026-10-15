import { supabase } from "./supabase";

/**
 * Two-tier (CMO 2026-10-08): whether a red event for this patient reaches a doctor (they are a Member). Asks the same
 * database rule the server uses (public.patient_has_feature_access, which for this feature also passes for a Member).
 * Returns null when it cannot be worked out, for example offline: the red screen then makes no claim either way, and the
 * server, which fails toward paging, decides.
 */
export async function loadDoctorReviewIncluded(patientIdArg?: string): Promise<boolean | null> {
  try {
    const patientId = patientIdArg ?? (await supabase.auth.getUser()).data.user?.id;
    if (!patientId) return null;
    const { data, error } = await supabase.rpc("patient_has_feature_access", {
      p_patient_id: patientId,
      p_feature: "vitals_red_flag_doctor_escalation",
    });
    if (error || typeof data !== "boolean") return null;
    return data;
  } catch {
    return null;
  }
}

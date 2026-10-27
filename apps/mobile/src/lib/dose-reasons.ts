import { supabase } from "./supabase";

/**
 * The person's choice, per private reason, to let supporters see it (item 5). Off unless they turn it on. The server decides who reads a
 * reason (RLS on medication_dose_reasons); this only reads and sets the person's own choice. Fails soft: a failed read is "unknown", which the
 * screen treats as off.
 */
export async function loadReasonSharing(patientId: string, code: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from("dose_reason_sharing")
      .select("share_with_supporters")
      .eq("patient_id", patientId)
      .eq("reason_code", code)
      .maybeSingle();
    if (error) return null;
    return data?.share_with_supporters === true;
  } catch {
    return null;
  }
}

export async function setReasonSharing(code: string, share: boolean, patientId?: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("set_dose_reason_sharing", { p_code: code, p_share: share, ...(patientId ? { p_patient: patientId } : {}) });
    return !error;
  } catch {
    return false;
  }
}

"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Thin wrapper over public.set_notify_on_patient_message() (see
 * 20260825163422_clinician_notify_on_patient_message_preference.sql) — a
 * narrow RPC rather than a direct clinical_staff update, since RLS on that
 * table is row-level only (any org staff may update any org member's row)
 * and clinical_staff is otherwise admin-managed.
 */
export async function setNotifyOnPatientMessage(enabled: boolean): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notify_on_patient_message", { p_enabled: enabled });
  if (error) return { error: error.message };
  return {};
}

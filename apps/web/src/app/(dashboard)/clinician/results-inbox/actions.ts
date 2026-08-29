"use server";

import { createClient } from "@/lib/supabase/server";

export type CancelRecallState = { error?: string; success?: boolean } | undefined;

/**
 * Thin wrapper over public.cancel_result_recall — the RPC itself gates to
 * an active clinical_staff row and writes the audit_log entry; this action
 * just adapts the useActionState/FormData contract every other clinician
 * mutation in this app uses.
 */
export async function cancelResultRecallAction(
  recallId: string,
  _prevState: CancelRecallState,
  formData: FormData
): Promise<CancelRecallState> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "Enter a reason for cancelling this recall" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_result_recall", {
    p_recall_id: recallId,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  return { success: true };
}

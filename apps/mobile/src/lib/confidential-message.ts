import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * Opens a confidential care-team thread from inside the Sexual &
 * Reproductive Health hub — mirrors apps/web/.../patient/sexual-health/
 * confidential-message-action.ts. Always passes p_confidential: true: a
 * thread here must stay invisible to a sponsor/supporter even when the
 * patient has granted them clinical_access for everything else. Safe direct
 * RPC — start_care_thread is SECURITY DEFINER and resolves the caller's own
 * patient/org from auth.uid() internally, no patientId parameter needed or
 * accepted. The ₦2,500 credit gate is enforced by a DB-side trigger, not
 * app code — never pre-check credit balance client-side, just catch this
 * marker in the error text, same pattern as care-support.ts's
 * ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER.
 */
export const CONFIDENTIAL_MESSAGE_CREDIT_REQUIRED_MARKER = "confidential message credit";

export async function startConfidentialSrhThread(subject: string, body: string): Promise<QueryResult<string>> {
  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  if (trimmedSubject.length < 3) return { ok: false, error: "Add a short subject" };
  if (trimmedBody.length === 0) return { ok: false, error: "Write a message" };

  const { data, error } = await supabase.rpc("start_care_thread", {
    p_subject: trimmedSubject.slice(0, 150),
    p_body: trimmedBody.slice(0, 4000),
    p_confidential: true,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as string };
}

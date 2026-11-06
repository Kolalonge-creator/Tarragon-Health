import "server-only";
import { getActingFor } from "@/lib/acting/acting-for";

/**
 * A patient's own result upload (lab result, ECG, imaging, a replacement copy) always files under the signed-in person:
 * the database only lets a patient insert for `auth.uid()` (lab_result_documents_insert and its siblings). While a
 * supporter is acting for someone, the page shows that person's Labs, so an upload there would quietly land on the
 * supporter's own record and the other person's care team would never see it (patient dashboard 2.0 slice E review).
 * Until uploading on someone's behalf is designed, these actions refuse while acting and say why.
 *
 * Returns the message to show, or null when the caller is not acting for anyone.
 */
export async function uploadRefusedWhileActing(): Promise<string | null> {
  const acting = await getActingFor();
  if (!acting) return null;
  const name = acting.fullName?.trim().split(/\s+/)[0] || "this person";
  return `You are managing ${name}'s account. Anything uploaded here would be saved to your own record, not theirs, so uploading is off while you manage their account. ${name === "this person" ? "They" : name} can upload it from their own account.`;
}

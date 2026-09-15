import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const REFERRAL_OUTCOME_DOC_BUCKET = "specialist-referral-outcome-documents";

/**
 * Mint a short-lived signed URL for a referral outcome document's storage
 * object. Uses the service-role client because org staff have no storage-
 * object read policy on this bucket (only the patient-own-folder policies
 * exist) — the row-level RLS on specialist_referrals is the real
 * authorisation gate, so the CALLER must already have read the row through
 * their own RLS-scoped session before asking for a URL. Never returns a
 * public URL. Mirrors lib/lab-results/documents.ts's signResultDocumentPath.
 */
export async function signReferralOutcomeDocumentPath(path: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(REFERRAL_OUTCOME_DOC_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

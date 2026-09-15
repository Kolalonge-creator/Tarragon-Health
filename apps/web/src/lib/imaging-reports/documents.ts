import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const IMAGING_REPORT_BUCKET = "imaging-reports";

/**
 * Mint a short-lived signed URL for an imaging report document's storage
 * object. Uses the service-role client because org staff have no
 * storage-object read policy (the bucket's policies only let a patient read
 * their own uid folder) — the row-level RLS on imaging_report_documents is
 * the real authorisation gate, so the CALLER must already have read the row
 * through their own RLS-scoped session before asking for a URL. Never
 * returns a public URL. Mirrors lib/ecg-reports/documents.ts's
 * signEcgReportPath exactly.
 */
export async function signImagingReportPath(path: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(IMAGING_REPORT_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

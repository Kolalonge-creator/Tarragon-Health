import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Security finding S4 (2026-11-05): a patient has no DELETE on the lab-result, ECG or imaging report buckets any more, so the
 * original of a filed report can never be removed by the patient (migration 20261105164215). The one thing the app still needs is
 * to clean up an object the SAME request has just uploaded when the database then refused the record (a duplicate, a refused
 * replace, a failed insert). That goes through here, on the server only:
 *
 * 1. public.discard_unfiled_clinical_upload (service role) answers true only for the patient's own upload, in their own folder, in
 *    one of the three buckets, that NO record points at; it writes the discard to the audit log.
 * 2. Only then is the object removed, with the service role, through the Storage API.
 *
 * A filed file, a care-team file, another patient's folder or any other bucket is left alone. Never throws: a clean-up that cannot
 * run leaves an orphaned object, which is the harmless side (it is reported to Sentry, ids only, never the path).
 */
export const CLINICAL_UPLOAD_BUCKETS = ["lab-result-documents", "ecg-reports", "imaging-reports"] as const;
export type ClinicalUploadBucket = (typeof CLINICAL_UPLOAD_BUCKETS)[number];

export async function discardUnfiledUpload(bucket: ClinicalUploadBucket, path: string, patientId: string): Promise<boolean> {
  try {
    // Cheap local refusal before any round trip: the path must sit in the patient's own folder.
    if (!(CLINICAL_UPLOAD_BUCKETS as readonly string[]).includes(bucket) || !path.startsWith(`${patientId}/`)) return false;
    const service = createServiceRoleClient();
    const { data: allowed, error } = await service.rpc("discard_unfiled_clinical_upload", {
      p_bucket: bucket,
      p_name: path,
      p_patient: patientId,
    });
    if (error) throw new Error(`discard check failed: ${error.message}`);
    if (allowed !== true) return false;
    const { error: removeError } = await service.storage.from(bucket).remove([path]);
    if (removeError) throw new Error(`storage remove failed: ${removeError.message}`);
    return true;
  } catch (e) {
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { extra: { bucket, where: "discard-unfiled-upload" } });
    return false;
  }
}

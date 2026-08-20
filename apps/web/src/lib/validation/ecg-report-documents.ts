import { z } from "zod";

/** Accepted ECG document types + 10 MB cap — mirrors the 'ecg-reports'
 * bucket's own allowed_mime_types/file_size_limit. */
export const ECG_DOC_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const ECG_DOC_MAX_BYTES = 10 * 1024 * 1024;
const ECG_DOC_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export function validateEcgDocFile(file: File): string | null {
  if (!ECG_DOC_MIME.has(file.type)) {
    return "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of the ECG printout";
  }
  if (file.size > ECG_DOC_MAX_BYTES) {
    return "That file is larger than 10 MB — try a photo instead of a scan";
  }
  return null;
}

/** Metadata a staff member (liaison/clinician/admin) attaches when uploading
 * an ECG for a patient. The document `source` is derived from the caller's
 * role server-side — never trusted from the client. */
export const staffEcgUploadSchema = z.object({
  patient_id: z.string().uuid(),
  lab_order_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type StaffEcgUploadInput = z.infer<typeof staffEcgUploadSchema>;

/** A patient uploading their own ECG. The document `source` is pinned to
 * 'patient' server-side and patient_id is taken from the session, never from
 * this input — the only thing the client chooses is which of their own open
 * orders (if any) it belongs to. */
export const patientEcgUploadSchema = z.object({
  lab_order_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type PatientEcgUploadInput = z.infer<typeof patientEcgUploadSchema>;

/** A clinician marking an uploaded ECG reviewed (interpreted). */
export const markEcgReportReviewedSchema = z.object({
  document_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type MarkEcgReportReviewedInput = z.infer<typeof markEcgReportReviewedSchema>;

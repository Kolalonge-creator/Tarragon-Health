import { z } from "zod";

/** Accepted result-document types + 10 MB cap — mirrors the
 * 'lab-result-documents' bucket's own allowed_mime_types/file_size_limit. */
export const RESULT_DOC_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const RESULT_DOC_MAX_BYTES = 10 * 1024 * 1024;
const RESULT_DOC_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export function validateResultDocFile(file: File): string | null {
  if (!RESULT_DOC_MIME.has(file.type)) {
    return "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of the result";
  }
  if (file.size > RESULT_DOC_MAX_BYTES) {
    return "That file is larger than 10 MB — try a photo instead of a scan";
  }
  return null;
}

/** Metadata a staff member (liaison/clinician/admin) attaches when uploading a
 * result for a patient. The document `source` is derived from the caller's role
 * server-side — never trusted from the client. */
export const staffResultUploadSchema = z.object({
  patient_id: z.string().uuid(),
  lab_order_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type StaffResultUploadInput = z.infer<typeof staffResultUploadSchema>;

/** A clinician marking an uploaded document reviewed (interpreted). */
export const markResultReviewedSchema = z.object({
  document_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type MarkResultReviewedInput = z.infer<typeof markResultReviewedSchema>;

import { z } from "zod";

/** Accepted imaging report document types + 20 MB cap — mirrors the
 * 'imaging-reports' bucket's own allowed_mime_types/file_size_limit. */
export const IMAGING_REPORT_DOC_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const IMAGING_REPORT_DOC_MAX_BYTES = 20 * 1024 * 1024;
const IMAGING_REPORT_DOC_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export function validateImagingReportDocFile(file: File): string | null {
  if (!IMAGING_REPORT_DOC_MIME.has(file.type)) {
    return "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of the imaging report";
  }
  if (file.size > IMAGING_REPORT_DOC_MAX_BYTES) {
    return "That file is larger than 20 MB — try a photo instead of a scan";
  }
  return null;
}

/** Metadata a staff member (clinician/admin) attaches when uploading an
 * imaging report for a patient. The document `source` is derived from the
 * caller's role server-side — never trusted from the client. */
export const staffImagingReportUploadSchema = z.object({
  patient_id: z.string().uuid(),
  imaging_order_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type StaffImagingReportUploadInput = z.infer<typeof staffImagingReportUploadSchema>;

/** A patient uploading their own imaging report (the self-arranged path —
 * they took the order to a facility, paid directly, and are uploading the
 * result themselves). The document `source` is pinned to 'patient' and
 * patient_id is taken from the session, never from this input. */
export const patientImagingReportUploadSchema = z.object({
  imaging_order_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type PatientImagingReportUploadInput = z.infer<typeof patientImagingReportUploadSchema>;

/** A clinician marking an uploaded imaging report document reviewed. */
export const markImagingReportDocumentReviewedSchema = z.object({
  document_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type MarkImagingReportDocumentReviewedInput = z.infer<
  typeof markImagingReportDocumentReviewedSchema
>;

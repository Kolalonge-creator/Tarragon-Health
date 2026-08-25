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

/** A patient uploading their own result from whichever lab they used. The
 * document `source` is pinned to 'patient' server-side and patient_id is taken
 * from the session, never from this input — the only thing the client chooses
 * is which of their own open orders (if any) it belongs to. */
export const patientResultUploadSchema = z.object({
  lab_order_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type PatientResultUploadInput = z.infer<typeof patientResultUploadSchema>;

/** A clinician marking an uploaded document reviewed and sending the patient a
 * plain-language interpretation of it. `interpretation` is required — a
 * document can't be marked reviewed without telling the patient what it
 * means. `next_steps` is optional: only fill it in when the result needs the
 * patient to actually do something. `note` stays internal-only, never shown
 * to the patient. */
export const markResultReviewedSchema = z.object({
  document_id: z.string().uuid(),
  interpretation: z
    .string()
    .trim()
    .min(10, "Write a short explanation the patient can read")
    .max(4000),
  next_steps: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(500).optional(),
});
export type MarkResultReviewedInput = z.infer<typeof markResultReviewedSchema>;

/** A partner lab uploading a result directly for one of its own orders (the
 * `lab_partner` account surface) — order ownership is re-verified server-side
 * via the scoped RPCs, never trusted from this input alone. */
export const labPartnerResultUploadSchema = z.object({
  order_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type LabPartnerResultUploadInput = z.infer<typeof labPartnerResultUploadSchema>;

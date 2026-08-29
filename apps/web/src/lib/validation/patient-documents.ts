import { z } from "zod";

/** Accepted document types + 25 MB cap — mirrors the 'patient-documents'
 * bucket's own allowed_mime_types/file_size_limit. */
export const PATIENT_DOCUMENT_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff";
const PATIENT_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const PATIENT_DOCUMENT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
]);

export function validatePatientDocumentFile(file: File): string | null {
  if (!PATIENT_DOCUMENT_MIME.has(file.type)) {
    return "Upload a PDF or a photo/scan (JPG, PNG, WEBP, HEIC, HEIF, TIFF)";
  }
  if (file.size > PATIENT_DOCUMENT_MAX_BYTES) {
    return "That file is larger than 25 MB";
  }
  return null;
}

const PATIENT_DOCUMENT_TYPES = [
  "laboratory_report",
  "imaging_report",
  "referral_letter",
  "consultation_note",
  "prescription",
  "discharge_summary",
  "consent_form",
  "invoice",
  "insurance_document",
  "identification_document",
  "clinical_photograph",
  "other",
] as const;

/**
 * A patient uploading a document to their own record.
 *
 * `patient_id`, `organisation_id`, `source` ('patient'), `status`, `category`
 * (generated column), and `uploaded_by` are all server-derived and never
 * trusted from this input — the only things the client actually chooses are
 * the type/title/description/date and (within the one option a patient may
 * pick) confidentiality. A patient may never set `confidentiality` to
 * `"restricted"` — that value is reserved for staff-authored documents — so
 * this schema only exposes `"standard"`/`"patient_private"` and the server
 * defaults to `"standard"` when the field is omitted.
 */
export const patientDocumentUploadSchema = z.object({
  document_type: z.enum(PATIENT_DOCUMENT_TYPES),
  title: z.string().trim().min(1, "Give this document a title").max(200),
  description: z.string().trim().max(1000).optional(),
  document_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .optional(),
  confidentiality: z.enum(["standard", "patient_private"]).default("standard"),
});
export type PatientDocumentUploadInput = z.infer<typeof patientDocumentUploadSchema>;

/** A patient archiving one of their own documents. The RPC itself enforces
 * that only the uploading patient (or org staff) may archive a given row —
 * this just validates the shape of what's sent. */
export const archivePatientDocumentSchema = z.object({
  document_id: z.string().uuid(),
  reason: z.string().trim().min(1, "Say why you're archiving this").max(500),
});
export type ArchivePatientDocumentInput = z.infer<typeof archivePatientDocumentSchema>;

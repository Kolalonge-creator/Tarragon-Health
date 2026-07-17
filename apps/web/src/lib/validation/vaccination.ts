import { z } from "zod";

export const logVaccinationSchema = z.object({
  vaccination_catalog_id: z.string().uuid(),
  dose_number: z.coerce.number().int().min(1).max(20),
  date_administered: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Enter a valid date" }),
  provider: z.string().trim().max(200).optional(),
  /** Optional booking this dose was received under (Priority #2: appointment → record). */
  booking_request_id: z.string().uuid().optional(),
});
export type LogVaccinationInput = z.infer<typeof logVaccinationSchema>;

/** Accepted certificate image/document types + 10 MB cap — mirrors the
 * storage bucket's own `allowed_mime_types`/`file_size_limit`. */
export const CERTIFICATE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const CERTIFICATE_MAX_BYTES = 10 * 1024 * 1024;
const CERTIFICATE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export function validateCertificateFile(file: File): string | null {
  if (!CERTIFICATE_MIME.has(file.type)) {
    return "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of your certificate";
  }
  if (file.size > CERTIFICATE_MAX_BYTES) {
    return "That file is larger than 10 MB — try a photo instead of a scan";
  }
  return null;
}

/** A clinician's verify/reject decision on an uploaded certificate. */
export const vaccinationVerificationDecisionSchema = z.object({
  record_id: z.string().uuid(),
  decision: z.enum(["verified", "rejected"]),
  note: z.string().trim().max(500).optional(),
});
export type VaccinationVerificationDecision = z.infer<
  typeof vaccinationVerificationDecisionSchema
>;

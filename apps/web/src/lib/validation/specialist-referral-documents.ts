import { z } from "zod";

/** Accepted outcome-document types + 10 MB cap — mirrors the
 * 'specialist-referral-outcome-documents' bucket's own allowed_mime_types/file_size_limit. */
export const REFERRAL_OUTCOME_DOC_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const REFERRAL_OUTCOME_DOC_MAX_BYTES = 10 * 1024 * 1024;
const REFERRAL_OUTCOME_DOC_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export function validateReferralOutcomeDocFile(file: File): string | null {
  if (!REFERRAL_OUTCOME_DOC_MIME.has(file.type)) {
    return "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of what the specialist gave you";
  }
  if (file.size > REFERRAL_OUTCOME_DOC_MAX_BYTES) {
    return "That file is larger than 10 MB — try a photo instead of a scan";
  }
  return null;
}

/** A patient uploading the specialist's own letter/report for a referral
 * that's theirs. referralId comes from the form, but the server action
 * re-verifies it belongs to the caller before writing anything. */
export const patientReferralOutcomeUploadSchema = z.object({
  referral_id: z.string().uuid(),
});
export type PatientReferralOutcomeUploadInput = z.infer<typeof patientReferralOutcomeUploadSchema>;

/** Org staff uploading a specialist's outcome document on a patient's
 * behalf (e.g. a printed letter the patient brought to a follow-up visit). */
export const staffReferralOutcomeUploadSchema = z.object({
  referral_id: z.string().uuid(),
});
export type StaffReferralOutcomeUploadInput = z.infer<typeof staffReferralOutcomeUploadSchema>;


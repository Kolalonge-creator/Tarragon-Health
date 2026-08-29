import { z } from "zod";

/** Accepted specialist-report document types + 10 MB cap — mirrors the
 * 'specialist-consultation-reports' bucket's own allowed_mime_types/file_size_limit. */
export const SPECIALIST_CONSULTATION_DOC_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const SPECIALIST_CONSULTATION_DOC_MAX_BYTES = 10 * 1024 * 1024;
const SPECIALIST_CONSULTATION_DOC_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export function validateSpecialistConsultationDocFile(file: File): string | null {
  if (!SPECIALIST_CONSULTATION_DOC_MIME.has(file.type)) {
    return "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of the specialist's report";
  }
  if (file.size > SPECIALIST_CONSULTATION_DOC_MAX_BYTES) {
    return "That file is larger than 10 MB — try a photo instead of a scan";
  }
  return null;
}

/** Metadata a staff member (clinician/care coordinator/admin) attaches when
 * uploading a specialist's report for a patient. The document `source` is
 * derived from the caller's role server-side — never trusted from the client. */
export const staffSpecialistConsultationUploadSchema = z.object({
  referral_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type StaffSpecialistConsultationUploadInput = z.infer<
  typeof staffSpecialistConsultationUploadSchema
>;

/** A patient uploading the report a specialist gave them. The document
 * `source` is pinned to 'patient' server-side and patient_id is taken from
 * the session — the only thing the client chooses is which of their own
 * referrals it belongs to. */
export const patientSpecialistConsultationUploadSchema = z.object({
  referral_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type PatientSpecialistConsultationUploadInput = z.infer<
  typeof patientSpecialistConsultationUploadSchema
>;

const acceptedRecommendationSchema = z.object({
  description: z.string().trim().min(1).max(500),
  action_type: z.enum([
    "repeat_test",
    "investigation",
    "follow_up_appointment",
    "medication_review",
    "care_plan_review",
    "other",
  ]),
  due_at: z.string().datetime().optional(),
});

/** A clinician confirming a drafted specialist-report extraction, filing it
 * onto the referral and creating one action item per accepted recommendation. */
export const confirmSpecialistConsultationExtractionSchema = z.object({
  extraction_id: z.string().uuid(),
  diagnosis: z.string().trim().min(1).max(2000),
  accepted_recommendations: z.array(acceptedRecommendationSchema).max(20),
  follow_up_interval_days: z.number().int().positive().max(3650).optional(),
  report_date: z.string().optional(),
});
export type ConfirmSpecialistConsultationExtractionInput = z.infer<
  typeof confirmSpecialistConsultationExtractionSchema
>;

/** A clinician adding a specialist-referral action item by hand, with no
 * extraction behind it (e.g. from a phone call with the specialist). */
export const addSpecialistReferralActionItemSchema = z.object({
  referral_id: z.string().uuid(),
  action_type: z.enum([
    "repeat_test",
    "investigation",
    "follow_up_appointment",
    "medication_review",
    "care_plan_review",
    "other",
  ]),
  description: z.string().trim().min(1).max(500),
  due_at: z.string().datetime().optional(),
});
export type AddSpecialistReferralActionItemInput = z.infer<
  typeof addSpecialistReferralActionItemSchema
>;

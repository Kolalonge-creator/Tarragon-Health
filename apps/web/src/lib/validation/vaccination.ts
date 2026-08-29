import { z } from "zod";

/** Mirrors public.vaccination_route — WHO-standard routes plus an escape hatch. */
export const VACCINATION_ROUTES = [
  "oral",
  "intramuscular",
  "subcutaneous",
  "intradermal",
  "intranasal",
  "other",
] as const;

export const logVaccinationSchema = z.object({
  vaccination_catalog_id: z.string().uuid(),
  dose_number: z.coerce.number().int().min(1).max(20),
  date_administered: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Enter a valid date" }),
  provider: z.string().trim().max(200).optional(),
  /** Optional booking this dose was received under (Priority #2: appointment → record). */
  booking_request_id: z.string().uuid().optional(),
  /** Spec §43.2: batch/lot, route/site and location "where available"/"where
   * relevant" — self-reported historical doses routinely won't have them. */
  batch_lot_number: z.string().trim().min(1).max(100).optional(),
  route: z.enum(VACCINATION_ROUTES).optional(),
  site: z.string().trim().min(1).max(200).optional(),
  location: z.string().trim().min(1).max(200).optional(),
});
export type LogVaccinationInput = z.infer<typeof logVaccinationSchema>;

/** A patient (or 'manage' caregiver) declining a due/overdue vaccine. */
export const declineVaccinationSchema = z.object({
  patientId: z.string().uuid(),
  vaccinationCatalogId: z.string().uuid(),
  note: z.string().trim().min(1).max(500).optional(),
});
export type DeclineVaccinationInput = z.infer<typeof declineVaccinationSchema>;

/** A clinical-tier doctor recording a contraindication — the reason is the
 * clinical documentation of why, so it is required, unlike a patient's own
 * decline note. */
export const markVaccinationContraindicatedSchema = z.object({
  patientId: z.string().uuid(),
  vaccinationCatalogId: z.string().uuid(),
  note: z.string().trim().min(1).max(500),
});
export type MarkVaccinationContraindicatedInput = z.infer<
  typeof markVaccinationContraindicatedSchema
>;

/** Mirrors public.vaccination_adverse_event_symptom. */
export const VACCINATION_ADVERSE_EVENT_SYMPTOMS = [
  "pain_at_site",
  "swelling_at_site",
  "redness_at_site",
  "fever",
  "allergic_reaction",
  "fatigue",
  "headache",
  "nausea",
  "other",
] as const;

/** Mirrors public.vaccination_adverse_event_severity. */
export const VACCINATION_ADVERSE_EVENT_SEVERITIES = ["mild", "moderate", "severe"] as const;

export const reportVaccinationAdverseEventSchema = z.object({
  vaccinationRecordId: z.string().uuid(),
  patientId: z.string().uuid(),
  symptoms: z.array(z.enum(VACCINATION_ADVERSE_EVENT_SYMPTOMS)).min(1, "Choose at least one symptom"),
  severity: z.enum(VACCINATION_ADVERSE_EVENT_SEVERITIES),
  description: z.string().trim().min(1).max(1000).optional(),
  onsetAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Enter a valid date" })
    .optional(),
});
export type ReportVaccinationAdverseEventInput = z.infer<
  typeof reportVaccinationAdverseEventSchema
>;

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

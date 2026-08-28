import { z } from "zod";

/** Accepted diagnostic report document types + 10 MB cap — mirrors the
 * 'diagnostic-reports' bucket's own allowed_mime_types/file_size_limit. */
export const DIAGNOSTIC_REPORT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const DIAGNOSTIC_REPORT_MAX_BYTES = 10 * 1024 * 1024;
const DIAGNOSTIC_REPORT_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export function validateDiagnosticReportFile(file: File): string | null {
  if (!DIAGNOSTIC_REPORT_MIME.has(file.type)) {
    return "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of the report";
  }
  if (file.size > DIAGNOSTIC_REPORT_MAX_BYTES) {
    return "That file is larger than 10 MB — try a photo instead of a scan";
  }
  return null;
}

/** A clinician creating a diagnostic request (15.2) — indication, clinical
 * question, urgency, relevant information. requested_by is server-derived
 * from the caller's active clinical_staff row, never client-supplied — see
 * private.derive_diagnostic_request_attribution. */
export const createDiagnosticRequestSchema = z.object({
  patient_id: z.string().uuid(),
  catalogue_id: z.string().uuid().optional(),
  modality: z.enum(["xray", "ultrasound", "ct", "mri", "ecg", "echocardiography", "mammography", "other"]),
  service_name: z.string().trim().min(1).max(200),
  indication: z.string().trim().min(1, "Indication is required").max(1000),
  clinical_question: z.string().trim().max(1000).optional(),
  relevant_information: z.string().trim().max(2000).optional(),
  urgency: z.enum(["routine", "urgent", "emergency"]).default("routine"),
});
export type CreateDiagnosticRequestInput = z.infer<typeof createDiagnosticRequestSchema>;

/** A patient (or someone booking on their behalf) setting a facility/date/
 * time-of-day/insurance preference on an already clinician-created request
 * (15.3) — mirrors request_lab_order_partner_visit's coarse-preference shape,
 * no fabricated real-time slot grid. */
export const diagnosticBookingPreferenceSchema = z.object({
  request_id: z.string().uuid(),
  facility_id: z.string().uuid().optional(),
  facility_name_freetext: z.string().trim().max(300).optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  preferred_time_of_day: z.enum(["morning", "afternoon", "evening"]).optional(),
  insurance_covered: z.boolean().optional(),
  insurance_note: z.string().trim().max(500).optional(),
});
export type DiagnosticBookingPreferenceInput = z.infer<typeof diagnosticBookingPreferenceSchema>;

/** Metadata a staff member (liaison/clinician/admin) attaches when uploading
 * a diagnostic report for a patient. Source is derived from the caller's
 * role server-side — never trusted from the client. */
export const staffDiagnosticReportUploadSchema = z.object({
  patient_id: z.string().uuid(),
  diagnostic_request_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type StaffDiagnosticReportUploadInput = z.infer<typeof staffDiagnosticReportUploadSchema>;

/** A patient uploading their own diagnostic report. Source is pinned to
 * 'patient' server-side, patient_id comes from the session. */
export const patientDiagnosticReportUploadSchema = z.object({
  diagnostic_request_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type PatientDiagnosticReportUploadInput = z.infer<typeof patientDiagnosticReportUploadSchema>;

/** A clinician filing the structured review (15.6/15.9) — findings,
 * impression, reporting clinician, date, facility, and the abnormal flag
 * that (when true) feeds the same Abnormal Result Engine every other
 * abnormal-result pathway on the platform uses. abnormal_severity is
 * required exactly when is_abnormal is true — enforced again at the DB
 * layer (diagnostic_reports_abnormal_requires_severity), this is the
 * friendly client-side mirror of that constraint. */
export const reviewDiagnosticReportSchema = z
  .object({
    report_id: z.string().uuid(),
    findings: z.string().trim().max(4000).optional(),
    impression: z.string().trim().max(2000).optional(),
    reporting_clinician_name: z.string().trim().max(200).optional(),
    report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
    facility_name: z.string().trim().max(300).optional(),
    review_note: z.string().trim().max(1000).optional(),
    is_abnormal: z.boolean(),
    abnormal_severity: z.enum(["abnormal", "critical"]).optional(),
  })
  .refine((val) => !val.is_abnormal || !!val.abnormal_severity, {
    message: "Select a severity (abnormal or critical) when flagging this report as abnormal",
    path: ["abnormal_severity"],
  });
export type ReviewDiagnosticReportInput = z.infer<typeof reviewDiagnosticReportSchema>;

/** A clinician confirming the abnormal-finding follow-up actually happened
 * (referral made, care plan updated, etc.) — mirrors
 * mark_result_document_action_completed's "the follow-up actually
 * happened" vs "the follow-up was written down" distinction. */
export const markDiagnosticReportActionCompletedSchema = z.object({
  report_id: z.string().uuid(),
});
export type MarkDiagnosticReportActionCompletedInput = z.infer<
  typeof markDiagnosticReportActionCompletedSchema
>;

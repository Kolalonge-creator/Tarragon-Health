import { z } from "zod";

// 13.8 — structured medication side-effect reporting: medication, symptom,
// onset, severity, duration. Severity drives clinical escalation server-side
// (moderate/severe raises a real clinician_alerts row — see
// 20260828021600_medication_side_effect_reports.sql), so it's kept a closed
// enum rather than free text.
export const medicationSideEffectSeverityValues = ["mild", "moderate", "severe"] as const;

export const medicationSideEffectReportSchema = z.object({
  medication_id: z.string().uuid(),
  symptom: z.string().trim().min(1, "Describe the symptom").max(300),
  onset_date: z
    .string()
    .optional()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
      message: "Enter a valid date",
    }),
  severity: z.enum(medicationSideEffectSeverityValues),
  duration_text: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
});
export type MedicationSideEffectReportInput = z.infer<typeof medicationSideEffectReportSchema>;

/** Clinician review action on an existing report. */
export const reviewMedicationSideEffectReportSchema = z.object({
  status: z.enum(["reviewed", "dismissed"]),
  review_notes: z.string().trim().max(1000).optional(),
});
export type ReviewMedicationSideEffectReportInput = z.infer<
  typeof reviewMedicationSideEffectReportSchema
>;

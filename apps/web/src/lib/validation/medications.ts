import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const scheduleTimesField = z
  .array(z.string().regex(HHMM, "Use 24-hour HH:MM, e.g. 08:00"))
  .max(6, "At most 6 doses per day")
  .default([]);

const takenAtStyleDateField = z
  .string()
  .optional()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
    message: "Enter a valid date",
  });

export const medicationSchema = z.object({
  drug_name: z.string().trim().min(1, "Drug name is required").max(200),
  dose: z.string().trim().max(100).optional(),
  frequency: z.string().trim().max(100).optional(),
  refill_date: takenAtStyleDateField,
  schedule_times: scheduleTimesField,
  care_plan_id: z.string().uuid().optional(),
  // Specialist attribution (pathway Scenario 3) — the external prescriber's
  // name and optional consultation document. Only meaningful when the record
  // is being added as a specialist-started medication.
  prescriber_name: z.string().trim().max(200).optional(),
  prescriber_document_url: z
    .string()
    .trim()
    .url("Enter a valid link (https://…)")
    .max(2000)
    .optional(),
  // Prescription order-entry detail (Care Team / Provider Workspace §5.10).
  // Clinician-source only — the patient self-add form never renders these.
  route: z.string().trim().max(100).optional(),
  duration_days: z.coerce.number().int().positive().optional(),
  quantity: z.string().trim().max(100).optional(),
  repeats_allowed: z.coerce.number().int().min(0).max(99).optional(),
  indication: z.string().trim().max(300).optional(),
  instructions: z.string().trim().max(1000).optional(),
});
export type MedicationInput = z.infer<typeof medicationSchema>;

/** Reason a medication was stopped/switched (pathway Scenario 2). */
export const stopMedicationSchema = z.object({
  stopped_reason: z.string().trim().max(300).optional(),
});
export type StopMedicationInput = z.infer<typeof stopMedicationSchema>;

/**
 * Prescription amendment (spec §62.14) — the fields public.amend_medication()
 * accepts. Every field but the reason is optional: only what actually
 * changed needs to be sent, the RPC falls back to the current version's
 * value for anything omitted (see 20260829010500_amend_medication.sql).
 */
export const amendMedicationSchema = z.object({
  amendment_reason: z.string().trim().min(1, "A reason for the amendment is required").max(300),
  drug_name: z.string().trim().min(1).max(200).optional(),
  dose: z.string().trim().max(100).optional(),
  frequency: z.string().trim().max(100).optional(),
  route: z.string().trim().max(100).optional(),
  duration_days: z.coerce.number().int().positive().optional(),
  quantity: z.string().trim().max(100).optional(),
  repeats_allowed: z.coerce.number().int().min(0).max(99).optional(),
  indication: z.string().trim().max(300).optional(),
  instructions: z.string().trim().max(1000).optional(),
  refill_date: takenAtStyleDateField,
  schedule_times: scheduleTimesField.optional(),
});
export type AmendMedicationInput = z.infer<typeof amendMedicationSchema>;

/** Clinical review of a patient's repeat request (spec §62.12). */
export const reviewMedicationRepeatRequestSchema = z
  .object({
    status: z.enum(["approved", "denied"]),
    denial_reason: z.string().trim().max(500).optional(),
    review_note: z.string().trim().max(500).optional(),
  })
  .refine((data) => data.status !== "denied" || !!data.denial_reason, {
    message: "A reason is required to deny a repeat request",
    path: ["denial_reason"],
  });
export type ReviewMedicationRepeatRequestInput = z.infer<
  typeof reviewMedicationRepeatRequestSchema
>;

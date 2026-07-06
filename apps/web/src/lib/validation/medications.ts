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
});
export type MedicationInput = z.infer<typeof medicationSchema>;

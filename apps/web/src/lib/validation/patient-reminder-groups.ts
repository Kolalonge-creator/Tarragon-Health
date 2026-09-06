import { z } from "zod";

/** Mirrors vitals_reminder_rules.frequency_days's own check constraint. */
const frequencyDaysField = z.coerce
  .number()
  .int()
  .min(1, "Must be at least 1 day")
  .max(90, "Must be at most 90 days");

export const createPatientReminderGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(200),
});
export type CreatePatientReminderGroupInput = z.infer<
  typeof createPatientReminderGroupSchema
>;

export const setReminderFrequencySchema = z.object({
  frequency_days: frequencyDaysField,
});
export type SetReminderFrequencyInput = z.infer<typeof setReminderFrequencySchema>;

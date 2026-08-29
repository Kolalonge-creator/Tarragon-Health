import { z } from "zod";

/** Module 21 §21.3 — "Were you able to obtain your medication?" */
export const medicationAccessCheckinSchema = z
  .object({
    medication_id: z.string().uuid(),
    obtained: z.enum(["yes", "partially", "no"]),
    barrier: z
      .enum(["too_expensive", "pharmacy_unavailable", "out_of_stock", "prescription_issue", "forgot", "other"])
      .optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((value) => value.obtained === "yes" || !!value.barrier, {
    message: "Please choose a reason",
    path: ["barrier"],
  });
export type MedicationAccessCheckinInput = z.infer<typeof medicationAccessCheckinSchema>;

/** Module 21 §21.11 — side-effect report. */
export const medicationSideEffectReportSchema = z.object({
  medication_id: z.string().uuid(),
  checkin_id: z.string().uuid().optional(),
  description: z.string().trim().min(1, "Tell us what you noticed").max(1000),
  severity: z.enum(["mild", "moderate", "severe"]),
});
export type MedicationSideEffectReportInput = z.infer<typeof medicationSideEffectReportSchema>;

/** Module 21 §21.13 reminder preferences. */
export const medicationReminderPreferencesSchema = z.object({
  dose_reminders_enabled: z.boolean(),
  missed_dose_prompts_enabled: z.boolean(),
});
export type MedicationReminderPreferencesInput = z.infer<typeof medicationReminderPreferencesSchema>;

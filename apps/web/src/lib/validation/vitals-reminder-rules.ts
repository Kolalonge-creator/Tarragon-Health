import { z } from "zod";
import { E164_NG } from "@tarragon/shared";

const frequencyDaysField = z.coerce
  .number()
  .int()
  .min(1, "Must be at least 1 day")
  .max(90, "Must be at most 90 days");

export const globalReminderRuleSchema = z.object({
  scope: z.literal("global"),
  frequency_days: frequencyDaysField,
});

/**
 * Only hypertension/diabetes have a distinct cadence in the business rule —
 * other care_plan_condition values fall back to the monthly default until
 * that changes, so there's no UI for them yet.
 */
export const conditionReminderRuleSchema = z.object({
  scope: z.literal("condition"),
  condition: z.enum(["hypertension", "diabetes"]),
  frequency_days: frequencyDaysField,
});

export const patientReminderRuleSchema = z.object({
  scope: z.literal("patient"),
  patient_phone: z.string().regex(E164_NG, "Enter a Nigerian number, e.g. +234XXXXXXXXXX"),
  frequency_days: frequencyDaysField,
});

export const vitalsReminderRuleSchema = z.discriminatedUnion("scope", [
  globalReminderRuleSchema,
  conditionReminderRuleSchema,
  patientReminderRuleSchema,
]);
export type VitalsReminderRuleInput = z.infer<typeof vitalsReminderRuleSchema>;

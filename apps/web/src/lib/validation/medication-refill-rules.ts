import { z } from "zod";
import { E164_NG } from "@tarragon/shared";

const leadDaysField = z.coerce
  .number()
  .int()
  .min(1, "Must be at least 1 day")
  .max(30, "Must be at most 30 days");

export const globalRefillRuleSchema = z.object({
  scope: z.literal("global"),
  lead_days: leadDaysField,
});

export const patientRefillRuleSchema = z.object({
  scope: z.literal("patient"),
  patient_phone: z.string().regex(E164_NG, "Enter a Nigerian number, e.g. +234XXXXXXXXXX"),
  lead_days: leadDaysField,
});

export const medicationRefillRuleSchema = z.discriminatedUnion("scope", [
  globalRefillRuleSchema,
  patientRefillRuleSchema,
]);
export type MedicationRefillRuleInput = z.infer<typeof medicationRefillRuleSchema>;

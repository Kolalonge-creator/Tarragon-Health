import { z } from "zod";
import { E164_NG } from "@tarragon/shared";

const dailyLimitField = z.coerce
  .number()
  .int()
  .min(1, "Must be at least 1 message")
  .max(500, "Must be at most 500 messages");

export const globalAiCoachAccessRuleSchema = z.object({
  scope: z.literal("global"),
  enabled: z.boolean().optional(),
  daily_limit: dailyLimitField.optional(),
});

export const patientAiCoachAccessRuleSchema = z.object({
  scope: z.literal("patient"),
  patient_phone: z.string().regex(E164_NG, "Enter a Nigerian number, e.g. +234XXXXXXXXXX"),
  enabled: z.boolean().optional(),
  daily_limit: dailyLimitField.optional(),
});

export const aiCoachAccessRuleSchema = z
  .discriminatedUnion("scope", [globalAiCoachAccessRuleSchema, patientAiCoachAccessRuleSchema])
  .refine((v) => v.enabled !== undefined || v.daily_limit !== undefined, {
    message: "Nothing to save",
  });
export type AiCoachAccessRuleInput = z.infer<typeof aiCoachAccessRuleSchema>;

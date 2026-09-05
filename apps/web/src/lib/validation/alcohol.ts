import { z } from "zod";

export const ALCOHOL_CONTEXTS = ["social", "home", "work", "other"] as const;

export const ALCOHOL_CONTEXT_LABELS: Record<(typeof ALCOHOL_CONTEXTS)[number], string> = {
  social: "Social occasion",
  home: "At home",
  work: "Work event",
  other: "Something else",
};

export const setAlcoholGoalSchema = z.object({
  target_drinks_per_week: z.coerce.number().int().min(0).max(200),
});
export type SetAlcoholGoalInput = z.infer<typeof setAlcoholGoalSchema>;

export const logAlcoholConsumptionSchema = z.object({
  drinks_count: z.coerce.number().int().min(0).max(100),
  context: z.enum(ALCOHOL_CONTEXTS).nullish(),
});
export type LogAlcoholConsumptionInput = z.infer<typeof logAlcoholConsumptionSchema>;

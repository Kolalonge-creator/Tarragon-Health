import { z } from "zod";

export const SYMPTOM_TYPES = [
  "pain",
  "fatigue",
  "breathlessness",
  "dizziness",
  "palpitations",
  "swelling",
  "nausea",
  "other",
] as const;

export const symptomLogSchema = z.object({
  symptom_type: z.enum(SYMPTOM_TYPES),
  severity: z.coerce.number().int().min(1, "Severity must be at least 1").max(10, "Severity must be at most 10"),
  description: z.string().trim().max(500).optional(),
});
export type SymptomLogInput = z.infer<typeof symptomLogSchema>;

import { z } from "zod";

export const secondOpinionRequestSchema = z.object({
  existingDiagnosisOrResult: z
    .string()
    .trim()
    .min(10, "Describe the result or diagnosis you'd like reviewed")
    .max(2000, "Please keep it under 2,000 characters"),
  sourceDescription: z.string().trim().max(300).optional(),
  specificQuestion: z.string().trim().max(500).optional(),
});

export const secondOpinionAnswerSchema = z.object({
  requestId: z.string().uuid(),
  answer: z
    .string()
    .trim()
    .min(10, "The answer needs a little more substance")
    .max(4000),
});

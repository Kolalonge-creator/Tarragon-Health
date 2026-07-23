import { z } from "zod";

export const ASYNC_CONSULT_CATEGORIES = [
  { value: "medication", label: "A question about my medicines" },
  { value: "symptom", label: "A symptom I'm unsure about" },
  { value: "results", label: "Understanding a result" },
  { value: "lifestyle", label: "Diet, exercise or lifestyle" },
  { value: "general", label: "Something else" },
] as const;

export const asyncConsultSchema = z.object({
  category: z.enum(
    ASYNC_CONSULT_CATEGORIES.map((c) => c.value) as [string, ...string[]]
  ),
  question: z
    .string()
    .trim()
    .min(10, "Tell us a little more so the doctor can actually help")
    .max(2000, "Please keep it under 2,000 characters"),
  durationNote: z.string().trim().max(200).optional(),
});

export const asyncConsultAnswerSchema = z.object({
  consultId: z.string().uuid(),
  answer: z
    .string()
    .trim()
    .min(10, "The answer needs a little more substance")
    .max(4000),
});

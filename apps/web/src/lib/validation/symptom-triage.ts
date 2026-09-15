import { z } from "zod";
import { symptomCaptureSchema } from "@tarragon/symptom-triage-engine";

/**
 * The Symptom Assessment & Triage Engine wizard (platform brief §37) is
 * multi-step: pick a presenting complaint, fill the structured initial
 * capture, then answer one dynamic question at a time (§37.6 — never the
 * whole tree up front). Each step's server action re-derives the current
 * position from scratch (never trusts a client-claimed "I'm on question 3"),
 * so the client only ever needs to round-trip the accumulated state — the
 * wizard calls its server action directly with a typed object (not a
 * <form action>), so no FormData/string-coercion layer is needed; this
 * schema is server-side defence-in-depth against a tampered request body,
 * not the only thing standing between the client and a bad value.
 */

const answerValueSchema = z.union([z.boolean(), z.string().min(1)]);

const answeredQuestionSchema = z.object({
  questionKey: z.string().min(1),
  prompt: z.string().min(1),
  answer: answerValueSchema,
  answeredAt: z.string(),
});

export { symptomCaptureSchema };

/** The full rolling wizard state a step action receives. */
export const symptomTriageStepSchema = z.object({
  capture: symptomCaptureSchema,
  answers: z.record(z.string(), answerValueSchema).default({}),
  questionLog: z.array(answeredQuestionSchema).default([]),
});
export type SymptomTriageStepInput = z.infer<typeof symptomTriageStepSchema>;

/** One newly-submitted answer, appended to `answers` before re-running the engine. */
export const symptomTriageAnswerSchema = z.object({
  questionKey: z.string().min(1),
  value: answerValueSchema,
});
export type SymptomTriageAnswerInput = z.infer<typeof symptomTriageAnswerSchema>;

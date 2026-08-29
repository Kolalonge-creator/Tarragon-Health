import { z } from "zod";

/**
 * Men's Health Platform (CLAUDE.md §45) structured self-assessments:
 * erectile dysfunction (IIEF-5), prostate urinary symptoms (IPSS), and a
 * short male-fertility intake. Each maps to a stored, structured value —
 * scored server-side (apps/web/src/lib/rules/ed-assessment-scoring.ts,
 * prostate-symptom-scoring.ts, male-fertility-assessment.ts), never trusting
 * a client-computed total or suggestion flag.
 */

const iief5Item = z.coerce.number().int().min(1).max(5);
const ipssItem = z.coerce.number().int().min(0).max(5);

const edFields = Object.fromEntries(
  Array.from({ length: 5 }, (_, i) => [`ed_${i + 1}`, iief5Item])
) as Record<`ed_${number}`, typeof iief5Item>;

export const edAssessmentSchema = z.object({ ...edFields });
export type EdAssessmentInput = z.infer<typeof edAssessmentSchema>;

/** IIEF-5 — each item asks about the last 6 months. */
export const IIEF5_QUESTIONS = [
  {
    prompt: "How do you rate your confidence that you could get and keep an erection?",
    options: ["Very low", "Low", "Moderate", "High", "Very high"],
  },
  {
    prompt: "When you had erections, how often were they hard enough for penetration?",
    options: ["Almost never/never", "A few times", "Sometimes", "Most times", "Almost always/always"],
  },
  {
    prompt: "During intercourse, how often were you able to maintain your erection after penetration?",
    options: ["Almost never/never", "A few times", "Sometimes", "Most times", "Almost always/always"],
  },
  {
    prompt: "During intercourse, how difficult was it to maintain your erection to completion?",
    options: ["Extremely difficult", "Very difficult", "Difficult", "Slightly difficult", "Not difficult"],
  },
  {
    prompt: "When you attempted intercourse, how often was it satisfactory for you?",
    options: ["Almost never/never", "A few times", "Sometimes", "Most times", "Almost always/always"],
  },
] as const;

const prostateFields = Object.fromEntries(
  Array.from({ length: 7 }, (_, i) => [`ipss_${i + 1}`, ipssItem])
) as Record<`ipss_${number}`, typeof ipssItem>;

export const prostateSymptomAssessmentSchema = z.object({
  ...prostateFields,
  family_history_prostate_cancer: z.coerce.boolean().default(false),
});
export type ProstateSymptomAssessmentInput = z.infer<typeof prostateSymptomAssessmentSchema>;

/** IPSS — each item asks about the last month, 0 (not at all) to 5 (almost always). */
export const IPSS_QUESTIONS = [
  "Incomplete emptying — a sense of not emptying your bladder completely after urinating",
  "Frequency — needing to urinate again less than two hours after finishing",
  "Intermittency — stopping and starting again several times while urinating",
  "Urgency — finding it difficult to postpone urination",
  "Weak stream — a weak urinary stream",
  "Straining — needing to push or strain to begin urinating",
  "Nocturia — how many times you typically get up to urinate during the night (0–5+ counted the same scale)",
] as const;

export const maleFertilityAssessmentSchema = z.object({
  trying_to_conceive_months: z.coerce.number().int().min(0).max(600),
  risk_factors: z
    .array(
      z.enum([
        "heat_exposure",
        "smoking",
        "heavy_alcohol",
        "prior_urological_surgery",
        "known_varicocele",
        "relevant_medical_condition",
      ])
    )
    .default([]),
  prior_semen_analysis: z.enum(["none", "normal", "abnormal", "pending"]).default("none"),
});
export type MaleFertilityAssessmentInput = z.infer<typeof maleFertilityAssessmentSchema>;

import { z } from "zod";
import type { Enums } from "@tarragon/shared";

/** Lifestyle goal domains — mirror the DB enum public.lifestyle_domain. */
export const LIFESTYLE_DOMAINS = ["diet", "exercise", "weight", "sleep", "stress"] as const;

// Compile-time guard: keep this list in lockstep with the DB enum.
const _domainCheck: readonly Enums<"lifestyle_domain">[] = LIFESTYLE_DOMAINS;
void _domainCheck;

export const LIFESTYLE_DOMAIN_LABELS: Record<(typeof LIFESTYLE_DOMAINS)[number], string> = {
  diet: "Diet",
  exercise: "Exercise",
  weight: "Weight",
  sleep: "Sleep",
  stress: "Stress",
};

/**
 * Baseline lifestyle assessment (the flow's first step). Every field is
 * optional — the assessment is skippable and re-takeable, and a patient may
 * only know some of these. Ranges match the DB CHECK constraints so a valid
 * form can never be rejected at the database.
 */
export const lifestyleAssessmentSchema = z.object({
  activity_minutes_weekly: z.coerce.number().int().min(0).max(10080).nullish(),
  sleep_hours_nightly: z.coerce.number().min(0).max(24).nullish(),
  stress_level: z.coerce.number().int().min(1).max(5).nullish(),
  diet_quality: z.coerce.number().int().min(1).max(5).nullish(),
  // The smokes <select> submits the literal strings "true"/"false" — NEVER use
  // z.coerce.boolean here, which turns any non-empty string (incl. "false")
  // into true. Map the two string values explicitly; pass through bool/null.
  smokes: z.preprocess(
    (v) => (v === "true" ? true : v === "false" ? false : v),
    z.boolean().nullish(),
  ),
  alcohol_units_weekly: z.coerce.number().int().min(0).max(200).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});
export type LifestyleAssessmentInput = z.infer<typeof lifestyleAssessmentSchema>;

/** A SMART goal in one domain. Weight/sleep/stress are captured as goals. */
export const lifestyleGoalSchema = z.object({
  domain: z.enum(LIFESTYLE_DOMAINS),
  title: z.string().trim().min(3, "Give your goal a short title").max(200),
  target_value: z.coerce.number().nullish(),
  target_unit: z.string().trim().max(30).nullish(),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .nullish(),
  notes: z.string().trim().max(1000).nullish(),
});
export type LifestyleGoalInput = z.infer<typeof lifestyleGoalSchema>;

/** Patient's in-app answer to a scheduled check-in (never over WhatsApp). */
export const lifestyleCheckinResponseSchema = z.object({
  response: z.string().trim().min(1, "Add a short response").max(1000),
});
export type LifestyleCheckinResponseInput = z.infer<typeof lifestyleCheckinResponseSchema>;

/** Clinician/coordinator notes when completing a progress review. */
export const lifestyleReviewCompletionSchema = z.object({
  notes: z.string().trim().max(2000).nullish(),
});
export type LifestyleReviewCompletionInput = z.infer<typeof lifestyleReviewCompletionSchema>;

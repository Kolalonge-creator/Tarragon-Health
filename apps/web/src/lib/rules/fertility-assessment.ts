/**
 * Fertility self-assessment recommendation (spec §47.9) — standard
 * evidence-based thresholds (ASRM/ACOG-style: a 12-month trying window
 * before a fertility work-up, shortened to 6 months at age 35+). Pure — no
 * DB access, no clock reads beyond the ageYears already computed by the
 * caller — so it's unit-testable and never trusts a client-supplied
 * recommendation.
 *
 * Decision order (a real risk factor always wins; duration then age decide
 * the rest):
 *   1. Any real risk factor present (anything other than "none") →
 *      "specialist_referral", regardless of duration or age.
 *   2. Trying < 6 months → "education_only" (too early to worry, regardless
 *      of age).
 *   3. Trying >= 12 months → "specialist_referral" (the standard threshold,
 *      any age).
 *   4. Trying 6-11 months — the "some trying, not yet at the 12-month
 *      threshold" band, resolved by age:
 *        - age known and >= 35 → "specialist_referral" (the 35+ shortcut:
 *          referral starts at 6 months, not 12).
 *        - age known and < 35 → "preconception_advice".
 *        - age unknown → "baseline_labs". We can't confirm or rule out the
 *          35+ shortcut without an age, so rather than either guessing
 *          "no referral needed" (preconception_advice) or over-escalating
 *          without cause, order the baseline labs a work-up would start
 *          with anyway — a safe middle step while age gets confirmed.
 */

export type FertilityRecommendedAction =
  | "education_only"
  | "preconception_advice"
  | "baseline_labs"
  | "specialist_referral";

export interface FertilityAssessmentRulesInput {
  tryingDurationMonths: number;
  ageYears: number | null;
  knownRiskFactors: string[];
}

const REFERRAL_DURATION_MONTHS = 12;
const REFERRAL_DURATION_MONTHS_AGE_35_PLUS = 6;
const AGE_SHORTCUT_YEARS = 35;

export function recommendFertilityAction(
  input: FertilityAssessmentRulesInput
): FertilityRecommendedAction {
  const { tryingDurationMonths, ageYears, knownRiskFactors } = input;

  const hasRealRiskFactor = knownRiskFactors.some((factor) => factor !== "none");
  if (hasRealRiskFactor) return "specialist_referral";

  if (tryingDurationMonths < REFERRAL_DURATION_MONTHS_AGE_35_PLUS) return "education_only";

  if (tryingDurationMonths >= REFERRAL_DURATION_MONTHS) return "specialist_referral";

  // From here: trying 6-11 months, no risk factors reported.
  if (ageYears === null) return "baseline_labs";
  if (ageYears >= AGE_SHORTCUT_YEARS) return "specialist_referral";
  return "preconception_advice";
}

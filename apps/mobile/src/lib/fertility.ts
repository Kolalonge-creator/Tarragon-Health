import { postFertilityAssessment } from "./api";
import type { QueryResult } from "./medications";

/**
 * Fertility self-assessment (spec §47.9). Mirrors apps/web/.../patient/
 * sexual-health/fertility-actions.ts. Age lookup and scoring
 * (recommendFertilityAction) happen server-side, via
 * /api/mobile/sexual-health/fertility-assessment — fertility_assessments
 * has no client-facing INSERT policy, and a 'specialist_referral' outcome
 * must open a real specialist_referrals row through the same service-role
 * path. **patientId is always the device owner's own id — see sti.ts's
 * header comment.**
 */

export const KNOWN_RISK_FACTORS = ["pcos", "endometriosis", "prior_pelvic_surgery", "irregular_cycles", "low_sperm_count_history", "none"] as const;
export type KnownRiskFactor = (typeof KNOWN_RISK_FACTORS)[number];
export const KNOWN_RISK_FACTOR_LABEL: Record<KnownRiskFactor, string> = {
  pcos: "PCOS (polycystic ovary syndrome)",
  endometriosis: "Endometriosis",
  prior_pelvic_surgery: "Prior pelvic surgery",
  irregular_cycles: "Irregular menstrual cycles",
  low_sperm_count_history: "History of low sperm count",
  none: "None of these",
};

export type FertilityRecommendedAction = "education_only" | "preconception_advice" | "baseline_labs" | "specialist_referral";

export const FERTILITY_RESULT_COPY: Record<FertilityRecommendedAction, { title: string; description: string }> = {
  education_only: {
    title: "You're just getting started",
    description:
      "It's still early days, so there's nothing to worry about yet. Keep an eye on your cycle, and come back to this check-in any time your situation changes.",
  },
  preconception_advice: {
    title: "You're in a normal range",
    description:
      "Trying for 6-11 months is still well within the normal window. Your care team has some preconception advice (timing, nutrition, and habits that help) to make the most of this stretch.",
  },
  baseline_labs: {
    title: "Worth a closer look",
    description:
      "You've been trying for a little while, so it's worth checking the basics with some baseline lab tests. Your care team will help you get these booked.",
  },
  specialist_referral: {
    title: "Time to bring in a specialist",
    description:
      "Based on what you've told us, it's worth seeing a specialist. We've started that referral and your care team will be in touch.",
  },
};

export interface FertilityAssessmentAnswers {
  trying_duration_months: number;
  menstrual_cycle_regular?: boolean;
  known_risk_factors: KnownRiskFactor[];
}

export async function submitFertilityAssessment(answers: FertilityAssessmentAnswers): Promise<QueryResult<FertilityRecommendedAction>> {
  if (!Number.isInteger(answers.trying_duration_months) || answers.trying_duration_months < 0 || answers.trying_duration_months > 120) {
    return { ok: false, error: "Enter a number of months between 0 and 120" };
  }
  const result = await postFertilityAssessment(answers);
  if (result.error || !result.success || !result.recommendedAction) {
    return { ok: false, error: result.error ?? "Please check your answers" };
  }
  return { ok: true, data: result.recommendedAction as FertilityRecommendedAction };
}

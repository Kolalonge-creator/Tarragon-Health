import type { CarePlanCondition } from "./condition-guidance";
import type { NutritionAnalysisResult } from "./nutrition-analysis";

/**
 * Nutrition professional pathway risk detection (spec 19.11): nutrition risk
 * -> dietitian referral -> consultation -> personalised plan -> Tarragon
 * care plan. This module only *surfaces* a suggestion for the patient (or
 * their care team) to act on — it never creates a referral by itself. That
 * keeps a human in the loop rather than auto-escalating from a coaching
 * heuristic, the same caution the rest of the nutrition module treats as
 * non-negotiable ("coaching telemetry only, never clinical").
 *
 * Pure module — conditions and recent analyses are passed in.
 */

// Kept in step with condition-guidance.ts's own per-meal watch thresholds.
const SODIUM_MEAL_WATCH_MG = 700;
const CARBS_MEAL_WATCH_G = 75;
const LOW_FIBRE_G = 5;
const PATTERN_LOOKBACK = 5;
const PATTERN_MIN_HITS = 3;

export type NutritionRiskReason =
  | "ckd_condition_needs_specialist_input"
  | "sustained_high_sodium_pattern"
  | "sustained_high_carb_low_fibre_pattern";

export interface NutritionRiskAssessment {
  atRisk: boolean;
  reasons: NutritionRiskReason[];
}

export const RISK_REASON_LABELS: Record<NutritionRiskReason, string> = {
  ckd_condition_needs_specialist_input:
    "CKD nutrition can be complex — a dietitian can tailor this to your own lab results",
  sustained_high_sodium_pattern:
    "Several recent meals have been higher in sodium than your blood pressure goals suggest",
  sustained_high_carb_low_fibre_pattern:
    "Several recent meals have been carb-heavy with little fibre alongside",
};

/** `recentAnalyses` should be the patient's most recent logged-meal
 * analyses, most recent first. */
export function detectNutritionRisk(
  conditions: readonly CarePlanCondition[],
  recentAnalyses: readonly NutritionAnalysisResult[],
): NutritionRiskAssessment {
  const reasons: NutritionRiskReason[] = [];
  const has = (c: CarePlanCondition) => conditions.includes(c);

  if (has("ckd")) {
    reasons.push("ckd_condition_needs_specialist_input");
  }

  const recent = recentAnalyses.slice(0, PATTERN_LOOKBACK).filter((a) => a.reliable);

  if (has("hypertension")) {
    const highSodiumCount = recent.filter((a) => a.sodiumMg > SODIUM_MEAL_WATCH_MG).length;
    if (highSodiumCount >= PATTERN_MIN_HITS) {
      reasons.push("sustained_high_sodium_pattern");
    }
  }

  if (has("diabetes")) {
    const highCarbLowFibreCount = recent.filter(
      (a) => a.carbsG > CARBS_MEAL_WATCH_G && a.fibreG < LOW_FIBRE_G,
    ).length;
    if (highCarbLowFibreCount >= PATTERN_MIN_HITS) {
      reasons.push("sustained_high_carb_low_fibre_pattern");
    }
  }

  return { atRisk: reasons.length > 0, reasons };
}

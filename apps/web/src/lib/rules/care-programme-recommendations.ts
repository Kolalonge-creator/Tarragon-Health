import type { Enums } from "@tarragon/shared";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";
import type { ComputedRiskScore } from "./risk-scoring";

/**
 * Rule-based mapping from the freshly computed prevention risk tiers + the
 * patient's questionnaire answers to a *recommended* chronic-care programme.
 *
 * This is deliberately conservative and defensible (not black-box): a
 * programme is only recommended when the top prevention tier is reached, when
 * the patient self-reports a matching existing diagnosis, or (for obesity)
 * when BMI crosses the clinical threshold.
 *
 * IMPORTANT (docs/CLINICAL_TRUST_MODEL_SPEC.md): the output is a *suggestion*
 * only. It is never a clinician-signed care plan and must never be presented
 * as doctor-reviewed. A clinician promotes a recommendation into a real
 * care_plans row; until then it stays "pending your care team's review".
 */

export type CarePlanCondition = Enums<"care_plan_condition">;
export type RecommendationTier = Enums<"risk_level">;

export interface CareProgrammeRecommendation {
  condition: CarePlanCondition;
  tier: RecommendationTier;
  rationale: string;
}

function bmiOf(responses: RiskAssessmentInput, weightKg: number | null): number | null {
  if (!weightKg || !responses.height_cm) return null;
  const heightM = responses.height_cm / 100;
  return weightKg / (heightM * heightM);
}

/**
 * @param scores    computeRiskTiers() output for this patient
 * @param responses the questionnaire the patient just submitted
 * @param weightKg  latest known weight (from responses or last vitals)
 */
export function computeCareProgrammeRecommendations(
  scores: ComputedRiskScore[],
  responses: RiskAssessmentInput,
  weightKg: number | null,
): CareProgrammeRecommendation[] {
  const tierByCondition = new Map(scores.map((score) => [score.condition, score.tier]));
  const diagnoses = new Set(responses.existing_diagnoses);
  const recommendations: CareProgrammeRecommendation[] = [];

  // Hypertension
  if (tierByCondition.get("hypertension") === "high" || diagnoses.has("hypertension")) {
    recommendations.push({
      condition: "hypertension",
      tier: diagnoses.has("hypertension") ? "high" : "moderate",
      rationale: diagnoses.has("hypertension")
        ? "You told us you've been diagnosed with high blood pressure."
        : "Your answers put you at higher risk for high blood pressure.",
    });
  }

  // Diabetes
  if (tierByCondition.get("diabetes") === "high" || diagnoses.has("diabetes")) {
    recommendations.push({
      condition: "diabetes",
      tier: diagnoses.has("diabetes") ? "high" : "moderate",
      rationale: diagnoses.has("diabetes")
        ? "You told us you've been diagnosed with diabetes."
        : "Your answers put you at higher risk for diabetes.",
    });
  }

  // Cardiovascular
  if (
    tierByCondition.get("cvd") === "high" ||
    diagnoses.has("heart_disease") ||
    diagnoses.has("high_cholesterol")
  ) {
    const forced = diagnoses.has("heart_disease") || diagnoses.has("high_cholesterol");
    recommendations.push({
      condition: "cardiovascular",
      tier: forced ? "high" : "moderate",
      rationale: diagnoses.has("heart_disease")
        ? "You told us about an existing heart condition."
        : diagnoses.has("high_cholesterol")
          ? "You told us about high cholesterol, which affects heart health."
          : "Your answers put you at higher cardiovascular risk.",
    });
  }

  // Obesity — BMI-driven only (no self-reported diagnosis tag exists)
  const bmi = bmiOf(responses, weightKg);
  if (bmi !== null && bmi >= 30) {
    recommendations.push({
      condition: "obesity",
      tier: bmi >= 35 ? "high" : "moderate",
      rationale: `Your BMI is around ${bmi.toFixed(0)}, which we can help you manage.`,
    });
  }

  return recommendations;
}

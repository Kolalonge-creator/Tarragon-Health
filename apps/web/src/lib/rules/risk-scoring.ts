import type { Enums } from "@tarragon/shared";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";

/**
 * Rule-based (not black-box) risk tiering per condition (spec §3.2: "V1
 * simplification — skip the AI health-age score, compute honest, defensible
 * rule-based tiers using standard risk factors"). Deliberately data-driven —
 * a config table of weighted factors + thresholds per condition, mirroring
 * how screen_types treats the screening catalog as data, not scattered
 * code — so a clinician can review/adjust weights later without an
 * engineer re-deriving logic.
 *
 * This engine only ever emits low/moderate/high (never `very_high`, which
 * belongs to the separate chronic-disease `patient_risk_scores`).
 */

export type PreventionCondition = Enums<"prevention_condition">;
export type RiskTier = "low" | "moderate" | "high";

export interface RiskScoringProfile {
  sex: Enums<"sex"> | null;
  ageYears: number | null;
  /** Most recent vitals_readings.weight_kg, if any. */
  weightKg: number | null;
}

export interface ComputedRiskScore {
  condition: PreventionCondition;
  tier: RiskTier;
  inputsSnapshot: Record<string, unknown>;
}

interface FactorRule {
  key: string;
  points: number;
  applies: (
    responses: RiskAssessmentInput,
    profile: RiskScoringProfile,
    bmi: number | null
  ) => boolean;
}

interface ConditionRules {
  condition: PreventionCondition;
  /** null = applies to both sexes. */
  sexApplicability: Enums<"sex"> | null;
  /** A self-reported existing diagnosis in this tag forces tier = 'high'. */
  forcedHighDiagnosisTag?: RiskAssessmentInput["existing_diagnoses"][number];
  factors: FactorRule[];
  moderateThreshold: number;
  highThreshold: number;
}

function bmiOf(profile: RiskScoringProfile, responses: RiskAssessmentInput): number | null {
  if (!profile.weightKg || !responses.height_cm) return null;
  const heightM = responses.height_cm / 100;
  return profile.weightKg / (heightM * heightM);
}

const hasFamilyCancer =
  (type: RiskAssessmentInput["family_cancer_types"][number]) =>
  (responses: RiskAssessmentInput) =>
    responses.family_cancer_types.includes(type);

const CONDITION_RULES: ConditionRules[] = [
  {
    condition: "hypertension",
    sexApplicability: null,
    forcedHighDiagnosisTag: "hypertension",
    moderateThreshold: 2,
    highThreshold: 5,
    factors: [
      { key: "family_history", points: 2, applies: (r) => r.family_hypertension },
      { key: "smoking_current", points: 2, applies: (r) => r.smoking_status === "current" },
      { key: "smoking_former", points: 1, applies: (r) => r.smoking_status === "former" },
      { key: "bmi_obese", points: 2, applies: (_r, _p, bmi) => bmi !== null && bmi >= 30 },
      { key: "bmi_overweight", points: 1, applies: (_r, _p, bmi) => bmi !== null && bmi >= 25 && bmi < 30 },
      { key: "age_45_plus", points: 1, applies: (_r, p) => p.ageYears !== null && p.ageYears >= 45 },
      { key: "alcohol_heavy", points: 1, applies: (r) => r.alcohol_use === "heavy" },
      { key: "stress_high", points: 1, applies: (r) => r.stress_level === "high" },
      { key: "exercise_none", points: 1, applies: (r) => r.exercise_frequency === "none" },
    ],
  },
  {
    condition: "diabetes",
    sexApplicability: null,
    forcedHighDiagnosisTag: "diabetes",
    moderateThreshold: 2,
    highThreshold: 5,
    factors: [
      { key: "family_history", points: 2, applies: (r) => r.family_diabetes },
      { key: "bmi_obese", points: 2, applies: (_r, _p, bmi) => bmi !== null && bmi >= 30 },
      { key: "bmi_overweight", points: 1, applies: (_r, _p, bmi) => bmi !== null && bmi >= 25 && bmi < 30 },
      { key: "age_35_plus", points: 1, applies: (_r, p) => p.ageYears !== null && p.ageYears >= 35 },
      { key: "exercise_none", points: 1, applies: (r) => r.exercise_frequency === "none" },
      { key: "diet_high_sugar", points: 1, applies: (r) => r.diet_pattern.includes("high_sugar") },
    ],
  },
  {
    condition: "cvd",
    sexApplicability: null,
    forcedHighDiagnosisTag: "heart_disease",
    moderateThreshold: 3,
    highThreshold: 6,
    factors: [
      { key: "family_history", points: 2, applies: (r) => r.family_heart_disease },
      { key: "smoking_current", points: 2, applies: (r) => r.smoking_status === "current" },
      { key: "smoking_former", points: 1, applies: (r) => r.smoking_status === "former" },
      { key: "existing_hypertension", points: 2, applies: (r) => r.existing_diagnoses.includes("hypertension") },
      { key: "existing_diabetes", points: 2, applies: (r) => r.existing_diagnoses.includes("diabetes") },
      { key: "bmi_obese", points: 1, applies: (_r, _p, bmi) => bmi !== null && bmi >= 30 },
      {
        key: "age_threshold",
        points: 1,
        applies: (_r, p) =>
          p.ageYears !== null &&
          ((p.sex === "male" && p.ageYears >= 45) || (p.sex === "female" && p.ageYears >= 55)),
      },
      { key: "alcohol_heavy", points: 1, applies: (r) => r.alcohol_use === "heavy" },
    ],
  },
  {
    condition: "breast_ca",
    sexApplicability: "female",
    moderateThreshold: 1,
    highThreshold: 4,
    factors: [
      { key: "family_history", points: 3, applies: hasFamilyCancer("breast") },
      { key: "age_40_plus", points: 1, applies: (_r, p) => p.ageYears !== null && p.ageYears >= 40 },
      { key: "age_50_plus", points: 1, applies: (_r, p) => p.ageYears !== null && p.ageYears >= 50 },
    ],
  },
  {
    condition: "cervical_ca",
    sexApplicability: "female",
    moderateThreshold: 1,
    highThreshold: 4,
    factors: [
      { key: "family_history", points: 3, applies: hasFamilyCancer("cervical") },
      { key: "not_hpv_vaccinated", points: 1, applies: (r) => !r.hpv_vaccinated },
      { key: "smoking_current", points: 1, applies: (r) => r.smoking_status === "current" },
    ],
  },
  {
    condition: "colorectal_ca",
    sexApplicability: null,
    moderateThreshold: 1,
    highThreshold: 4,
    factors: [
      { key: "family_history", points: 3, applies: hasFamilyCancer("colorectal") },
      { key: "age_45_plus", points: 1, applies: (_r, p) => p.ageYears !== null && p.ageYears >= 45 },
      { key: "smoking_current", points: 1, applies: (r) => r.smoking_status === "current" },
      { key: "diet_low_fibre", points: 1, applies: (r) => r.diet_pattern.includes("low_fibre") },
      { key: "alcohol_heavy", points: 1, applies: (r) => r.alcohol_use === "heavy" },
    ],
  },
  {
    condition: "prostate_ca",
    sexApplicability: "male",
    moderateThreshold: 1,
    highThreshold: 4,
    factors: [
      { key: "family_history", points: 3, applies: hasFamilyCancer("prostate") },
      { key: "age_45_plus", points: 1, applies: (_r, p) => p.ageYears !== null && p.ageYears >= 45 },
      { key: "age_50_plus", points: 1, applies: (_r, p) => p.ageYears !== null && p.ageYears >= 50 },
    ],
  },
];

/**
 * Computes a tier per applicable condition. Sex-inapplicable conditions
 * (e.g. breast_ca for a male profile) are skipped, not computed — same for
 * an unknown/unset sex on a sex-specific condition, to avoid presenting a
 * tier before the profile's `sex` field is actually on file.
 */
export function computeRiskTiers(
  responses: RiskAssessmentInput,
  profile: RiskScoringProfile
): ComputedRiskScore[] {
  const bmi = bmiOf(profile, responses);
  const results: ComputedRiskScore[] = [];

  for (const rules of CONDITION_RULES) {
    if (rules.sexApplicability && rules.sexApplicability !== profile.sex) continue;

    if (rules.forcedHighDiagnosisTag && responses.existing_diagnoses.includes(rules.forcedHighDiagnosisTag)) {
      results.push({
        condition: rules.condition,
        tier: "high",
        inputsSnapshot: { forced_by: "existing_diagnosis", diagnosis: rules.forcedHighDiagnosisTag },
      });
      continue;
    }

    const matchedFactors = rules.factors.filter((factor) => factor.applies(responses, profile, bmi));
    const score = matchedFactors.reduce((sum, factor) => sum + factor.points, 0);
    const tier: RiskTier =
      score >= rules.highThreshold ? "high" : score >= rules.moderateThreshold ? "moderate" : "low";

    results.push({
      condition: rules.condition,
      tier,
      inputsSnapshot: {
        score,
        factors: matchedFactors.map((factor) => factor.key),
        bmi: bmi !== null ? Math.round(bmi * 10) / 10 : null,
      },
    });
  }

  return results;
}

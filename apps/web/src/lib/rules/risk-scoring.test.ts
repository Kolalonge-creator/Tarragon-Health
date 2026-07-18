import { describe, expect, it } from "@jest/globals";
import { computeRiskTiers, type RiskScoringProfile } from "./risk-scoring";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";

const baseResponses: RiskAssessmentInput = {
  family_diabetes: false,
  family_hypertension: false,
  family_heart_disease: false,
  family_sickle_cell: false,
  family_cancer_types: [],
  family_cancer_other_detail: undefined,
  smoking_status: "never",
  cigarettes_per_day: undefined,
  alcohol_use: "none",
  exercise_days_per_week: 5,
  exercise_minutes_per_session: 45,
  diet_pattern: ["balanced"],
  sleep_hours: "7_to_8",
  stress_level: "low",
  height_cm: 170,
  weight_kg: undefined,
  existing_diagnoses: [],
  existing_diagnoses_other_detail: undefined,
  current_medications: undefined,
  hpv_vaccinated: true,
  other_vaccines_detail: undefined,
  prior_abnormal_result: false,
};

const baseProfile: RiskScoringProfile = {
  sex: "female",
  ageYears: 30,
  weightKg: 60,
};

describe("computeRiskTiers", () => {
  it("skips sex-inapplicable conditions — no breast_ca/cervical_ca for a male profile", () => {
    const results = computeRiskTiers(baseResponses, { ...baseProfile, sex: "male" });
    const conditions = results.map((r) => r.condition);
    expect(conditions).not.toContain("breast_ca");
    expect(conditions).not.toContain("cervical_ca");
    expect(conditions).toContain("prostate_ca");
  });

  it("skips prostate_ca for a female profile", () => {
    const results = computeRiskTiers(baseResponses, baseProfile);
    const conditions = results.map((r) => r.condition);
    expect(conditions).not.toContain("prostate_ca");
    expect(conditions).toContain("breast_ca");
    expect(conditions).toContain("cervical_ca");
  });

  it("computes low tier when no risk factors are present", () => {
    const results = computeRiskTiers(baseResponses, baseProfile);
    const hypertension = results.find((r) => r.condition === "hypertension");
    expect(hypertension?.tier).toBe("low");
  });

  it("forces high tier when the patient already has a matching diagnosis", () => {
    const responses: RiskAssessmentInput = {
      ...baseResponses,
      existing_diagnoses: ["hypertension"],
    };
    const results = computeRiskTiers(responses, baseProfile);
    const hypertension = results.find((r) => r.condition === "hypertension");
    expect(hypertension?.tier).toBe("high");
    expect(hypertension?.inputsSnapshot).toMatchObject({ forced_by: "existing_diagnosis" });
  });

  it("raises the diabetes tier with family history + obesity + inactivity", () => {
    const responses: RiskAssessmentInput = {
      ...baseResponses,
      family_diabetes: true,
      exercise_days_per_week: 0,
      exercise_minutes_per_session: 0,
      diet_pattern: ["high_sugar"],
    };
    const results = computeRiskTiers(responses, { ...baseProfile, weightKg: 95, ageYears: 40 });
    const diabetes = results.find((r) => r.condition === "diabetes");
    // family_history(2) + bmi_obese(2) + age_35_plus(1) + insufficient_exercise(1) + diet_high_sugar(1) = 7 -> high
    expect(diabetes?.tier).toBe("high");
  });

  it("raises breast_ca tier on family history", () => {
    const responses: RiskAssessmentInput = {
      ...baseResponses,
      family_cancer_types: ["breast"],
    };
    const results = computeRiskTiers(responses, { ...baseProfile, ageYears: 55 });
    const breastCa = results.find((r) => r.condition === "breast_ca");
    // family_history(3) + age_40_plus(1) + age_50_plus(1) = 5 -> high
    expect(breastCa?.tier).toBe("high");
  });

  it("does not compute BMI-dependent factors when height/weight are unknown", () => {
    const results = computeRiskTiers(baseResponses, { ...baseProfile, weightKg: null });
    const hypertension = results.find((r) => r.condition === "hypertension");
    expect((hypertension?.inputsSnapshot as { bmi: number | null }).bmi).toBeNull();
  });

  it("adds a smoking_heavy bump on top of smoking_current for >10 cigarettes/day", () => {
    const responses: RiskAssessmentInput = {
      ...baseResponses,
      smoking_status: "current",
      cigarettes_per_day: "11_20",
    };
    const results = computeRiskTiers(responses, baseProfile);
    const hypertension = results.find((r) => r.condition === "hypertension");
    const factors = (hypertension?.inputsSnapshot as { factors: string[] }).factors;
    expect(factors).toContain("smoking_current");
    expect(factors).toContain("smoking_heavy");
  });

  it("does not add the smoking_heavy bump for a light current smoker", () => {
    const responses: RiskAssessmentInput = {
      ...baseResponses,
      smoking_status: "current",
      cigarettes_per_day: "1_5",
    };
    const results = computeRiskTiers(responses, baseProfile);
    const hypertension = results.find((r) => r.condition === "hypertension");
    const factors = (hypertension?.inputsSnapshot as { factors: string[] }).factors;
    expect(factors).toContain("smoking_current");
    expect(factors).not.toContain("smoking_heavy");
  });

  it("flags poor_sleep for short sleep duration", () => {
    const responses: RiskAssessmentInput = { ...baseResponses, sleep_hours: "less_than_5" };
    const results = computeRiskTiers(responses, baseProfile);
    const hypertension = results.find((r) => r.condition === "hypertension");
    const diabetes = results.find((r) => r.condition === "diabetes");
    expect((hypertension?.inputsSnapshot as { factors: string[] }).factors).toContain("poor_sleep");
    expect((diabetes?.inputsSnapshot as { factors: string[] }).factors).toContain("poor_sleep");
  });

  it("flags poor_sleep for long sleep duration", () => {
    const responses: RiskAssessmentInput = { ...baseResponses, sleep_hours: "more_than_8" };
    const results = computeRiskTiers(responses, baseProfile);
    const hypertension = results.find((r) => r.condition === "hypertension");
    expect((hypertension?.inputsSnapshot as { factors: string[] }).factors).toContain("poor_sleep");
  });

  it("flags insufficient_exercise under 150 minutes/week", () => {
    const responses: RiskAssessmentInput = {
      ...baseResponses,
      exercise_days_per_week: 2,
      exercise_minutes_per_session: 20, // 40 min/week
    };
    const results = computeRiskTiers(responses, baseProfile);
    const hypertension = results.find((r) => r.condition === "hypertension");
    expect((hypertension?.inputsSnapshot as { factors: string[] }).factors).toContain(
      "insufficient_exercise"
    );
  });

  it("does not flag insufficient_exercise at or above 150 minutes/week", () => {
    const responses: RiskAssessmentInput = {
      ...baseResponses,
      exercise_days_per_week: 3,
      exercise_minutes_per_session: 60, // 180 min/week
    };
    const results = computeRiskTiers(responses, baseProfile);
    const hypertension = results.find((r) => r.condition === "hypertension");
    expect((hypertension?.inputsSnapshot as { factors: string[] }).factors).not.toContain(
      "insufficient_exercise"
    );
  });
});

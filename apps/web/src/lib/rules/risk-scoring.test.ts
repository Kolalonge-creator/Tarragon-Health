import { describe, expect, it } from "@jest/globals";
import { computeRiskTiers, type RiskScoringProfile } from "./risk-scoring";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";

const baseResponses: RiskAssessmentInput = {
  family_diabetes: false,
  family_hypertension: false,
  family_heart_disease: false,
  family_sickle_cell: false,
  family_cancer_types: [],
  smoking_status: "never",
  alcohol_use: "none",
  exercise_frequency: "3_plus_per_week",
  diet_pattern: ["balanced"],
  sleep_quality: "good",
  stress_level: "low",
  height_cm: 170,
  existing_diagnoses: [],
  current_medications: undefined,
  hpv_vaccinated: true,
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
      exercise_frequency: "none",
      diet_pattern: ["high_sugar"],
    };
    const results = computeRiskTiers(responses, { ...baseProfile, weightKg: 95, ageYears: 40 });
    const diabetes = results.find((r) => r.condition === "diabetes");
    // family_history(2) + bmi_obese(2) + age_35_plus(1) + exercise_none(1) + diet_high_sugar(1) = 7 -> high
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
});

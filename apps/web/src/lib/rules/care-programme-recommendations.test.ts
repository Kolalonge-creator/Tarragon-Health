import { describe, expect, it } from "@jest/globals";
import {
  computeCareProgrammeRecommendations,
} from "./care-programme-recommendations";
import type { ComputedRiskScore } from "./risk-scoring";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";

const BASE: RiskAssessmentInput = {
  family_diabetes: false,
  family_hypertension: false,
  family_heart_disease: false,
  family_sickle_cell: false,
  family_cancer_types: [],
  smoking_status: "never",
  alcohol_use: "none",
  exercise_days_per_week: 5,
  exercise_minutes_per_session: 30,
  diet_pattern: [],
  sleep_hours: "7_to_8",
  stress_level: "low",
  height_cm: 170,
  existing_diagnoses: [],
  hpv_vaccinated: false,
  prior_abnormal_result: false,
};

const score = (
  condition: ComputedRiskScore["condition"],
  tier: ComputedRiskScore["tier"],
): ComputedRiskScore => ({ condition, tier, inputsSnapshot: {} });

describe("computeCareProgrammeRecommendations", () => {
  it("recommends nothing for a low-risk patient", () => {
    const recs = computeCareProgrammeRecommendations(
      [score("hypertension", "low"), score("diabetes", "low"), score("cvd", "low")],
      BASE,
      65,
    );
    expect(recs).toHaveLength(0);
  });

  it("recommends hypertension when the tier is high", () => {
    const recs = computeCareProgrammeRecommendations([score("hypertension", "high")], BASE, 65);
    expect(recs).toEqual([
      expect.objectContaining({ condition: "hypertension", tier: "moderate" }),
    ]);
  });

  it("forces hypertension to high tier when self-reported", () => {
    const recs = computeCareProgrammeRecommendations(
      [score("hypertension", "low")],
      { ...BASE, existing_diagnoses: ["hypertension"] },
      65,
    );
    expect(recs).toEqual([
      expect.objectContaining({ condition: "hypertension", tier: "high" }),
    ]);
  });

  it("maps heart_disease / high_cholesterol to the cardiovascular programme", () => {
    const recs = computeCareProgrammeRecommendations(
      [],
      { ...BASE, existing_diagnoses: ["high_cholesterol"] },
      65,
    );
    expect(recs.map((r) => r.condition)).toContain("cardiovascular");
  });

  it("recommends obesity from BMI >= 30 and high from >= 35", () => {
    // 100kg @ 170cm -> BMI ~34.6 -> moderate
    const moderate = computeCareProgrammeRecommendations([], BASE, 100);
    expect(moderate).toEqual([expect.objectContaining({ condition: "obesity", tier: "moderate" })]);
    // 105kg @ 170cm -> BMI ~36.3 -> high
    const high = computeCareProgrammeRecommendations([], BASE, 105);
    expect(high).toEqual([expect.objectContaining({ condition: "obesity", tier: "high" })]);
  });

  it("does not recommend obesity without a weight", () => {
    const recs = computeCareProgrammeRecommendations([], BASE, null);
    expect(recs.some((r) => r.condition === "obesity")).toBe(false);
  });
});

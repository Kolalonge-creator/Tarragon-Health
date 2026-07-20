/**
 * FINDRISC — Finnish Diabetes Risk Score (§5.1, validated in Nigeria). A pure,
 * standard point-scored tool: age, BMI, waist, activity, diet, BP treatment,
 * history of high glucose, and family history give a risk band. Stage 2 of the
 * two-stage screen (§5.1): a moderate-or-higher band → proceed to a diagnostic
 * blood test (FPG or HbA1c, §6).
 */

export type Sex = "male" | "female";
export type FamilyHistory = "none" | "second_degree" | "first_degree";

export interface FindriscInput {
  ageYears: number;
  bmi: number;
  waistCm: number;
  sex: Sex;
  physicallyActive: boolean; // ≥30 min/day most days
  eatsVegetablesFruitDaily: boolean;
  onBpMedication: boolean;
  historyOfHighGlucose: boolean; // ever told glucose was high (illness, pregnancy, check-up)
  familyHistory: FamilyHistory;
}

export type FindriscBand = "low" | "slightly_elevated" | "moderate" | "high" | "very_high";

export interface FindriscResult {
  score: number;
  band: FindriscBand;
  /** Approximate 10-year risk of developing type 2 diabetes, for context. */
  approxTenYearRisk: string;
  /** Whether the two-stage screen should proceed to a diagnostic blood test. */
  recommendBloodTest: boolean;
}

function agePoints(age: number): number {
  if (age < 45) return 0;
  if (age <= 54) return 2;
  if (age <= 64) return 3;
  return 4;
}

function bmiPoints(bmi: number): number {
  if (bmi < 25) return 0;
  if (bmi <= 30) return 1;
  return 3;
}

function waistPoints(waist: number, sex: Sex): number {
  if (sex === "male") {
    if (waist < 94) return 0;
    if (waist <= 102) return 3;
    return 4;
  }
  if (waist < 80) return 0;
  if (waist <= 88) return 3;
  return 4;
}

function familyPoints(fh: FamilyHistory): number {
  if (fh === "none") return 0;
  if (fh === "second_degree") return 3;
  return 5;
}

export function scoreFindrisc(input: FindriscInput): FindriscResult {
  const score =
    agePoints(input.ageYears) +
    bmiPoints(input.bmi) +
    waistPoints(input.waistCm, input.sex) +
    (input.physicallyActive ? 0 : 2) +
    (input.eatsVegetablesFruitDaily ? 0 : 1) +
    (input.onBpMedication ? 2 : 0) +
    (input.historyOfHighGlucose ? 5 : 0) +
    familyPoints(input.familyHistory);

  let band: FindriscBand;
  let approxTenYearRisk: string;
  if (score < 7) {
    band = "low";
    approxTenYearRisk = "about 1 in 100";
  } else if (score < 12) {
    band = "slightly_elevated";
    approxTenYearRisk = "about 1 in 25";
  } else if (score < 15) {
    band = "moderate";
    approxTenYearRisk = "about 1 in 6";
  } else if (score <= 20) {
    band = "high";
    approxTenYearRisk = "about 1 in 3";
  } else {
    band = "very_high";
    approxTenYearRisk = "about 1 in 2";
  }

  return { score, band, approxTenYearRisk, recommendBloodTest: score >= 12 };
}

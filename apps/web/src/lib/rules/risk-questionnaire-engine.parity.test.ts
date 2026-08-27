import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { computeRiskTiers, type RiskScoringProfile } from "./risk-scoring";
import { computeRiskFromConfig, type RiskQuestionnaireConfigPayload } from "./risk-questionnaire-engine";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";

/**
 * Proves the config-driven engine reproduces risk-scoring.ts's hardcoded
 * CONDITION_RULES exactly, tier-for-tier, across the same scenarios
 * risk-scoring.test.ts covers. Loads the seeded v1 config straight out of
 * migration 20260827200508_risk_questionnaire_configs.sql (the actual
 * $config$...$config$ jsonb literal, not a hand-copied TS re-transcription)
 * so there is exactly one source of truth for what "v1" contains — a typo
 * in either the SQL or a separate TS fixture could otherwise drift
 * unnoticed.
 */
const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../../supabase/migrations/20260827200508_risk_questionnaire_configs.sql",
);

function loadSeededV1Config(): RiskQuestionnaireConfigPayload {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const match = sql.match(/\$config\$\n([\s\S]*?)\n\$config\$::jsonb/);
  if (!match) {
    throw new Error(`Could not find $config$...$config$ jsonb literal in ${MIGRATION_PATH}`);
  }
  return JSON.parse(match[1]) as RiskQuestionnaireConfigPayload;
}

const PREVENTION_INTAKE_V1 = loadSeededV1Config();

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

const baseProfile: RiskScoringProfile = { sex: "female", ageYears: 30, weightKg: 60 };

function tiersOf(responses: RiskAssessmentInput, profile: RiskScoringProfile) {
  const legacy = computeRiskTiers(responses, profile);
  const configDriven = computeRiskFromConfig(PREVENTION_INTAKE_V1, responses as unknown as Record<string, unknown>, profile);
  return { legacy, configDriven };
}

describe("seeded v1 config structure", () => {
  it("ports all 7 legacy conditions and all 22 legacy questions", () => {
    expect(PREVENTION_INTAKE_V1.conditions).toHaveLength(7);
    expect(PREVENTION_INTAKE_V1.questions).toHaveLength(22);
  });
});

describe("config-driven engine parity with the legacy hardcoded engine", () => {
  const scenarios: Array<[string, Partial<RiskAssessmentInput>, Partial<RiskScoringProfile>]> = [
    ["no risk factors", {}, {}],
    ["existing hypertension diagnosis", { existing_diagnoses: ["hypertension"] }, {}],
    [
      "diabetes: family history + obesity + inactivity",
      { family_diabetes: true, exercise_days_per_week: 0, exercise_minutes_per_session: 0, diet_pattern: ["high_sugar"] },
      { weightKg: 95, ageYears: 40 },
    ],
    ["breast_ca family history", { family_cancer_types: ["breast"] }, { ageYears: 55 }],
    ["heavy current smoker", { smoking_status: "current", cigarettes_per_day: "11_20" }, {}],
    ["light current smoker", { smoking_status: "current", cigarettes_per_day: "1_5" }, {}],
    ["short sleep", { sleep_hours: "less_than_5" }, {}],
    ["long sleep", { sleep_hours: "more_than_8" }, {}],
    ["insufficient exercise", { exercise_days_per_week: 2, exercise_minutes_per_session: 20 }, {}],
    ["sufficient exercise", { exercise_days_per_week: 3, exercise_minutes_per_session: 60 }, {}],
    ["cvd age threshold, male", {}, { sex: "male", ageYears: 46 }],
    ["male profile", {}, { sex: "male" }],
    ["existing diabetes diagnosis", { existing_diagnoses: ["diabetes"] }, {}],
    ["existing heart_disease diagnosis", { existing_diagnoses: ["heart_disease"] }, {}],
    ["cervical_ca: not HPV vaccinated", { hpv_vaccinated: false }, {}],
    ["colorectal_ca: family history + smoking + low fibre + heavy alcohol", {
      family_cancer_types: ["colorectal"], smoking_status: "current", cigarettes_per_day: "20_plus",
      diet_pattern: ["low_fibre"], alcohol_use: "heavy",
    }, { ageYears: 50 }],
    ["prostate_ca family history, male", { family_cancer_types: ["prostate"] }, { sex: "male", ageYears: 55 }],
    ["cvd age threshold, female under 55 (should not trigger)", {}, { sex: "female", ageYears: 50 }],
  ];

  it.each(scenarios)("%s — same tier for every emitted condition", (_label, responseOverrides, profileOverrides) => {
    const responses: RiskAssessmentInput = { ...baseResponses, ...responseOverrides };
    const profile: RiskScoringProfile = { ...baseProfile, ...profileOverrides };
    const { legacy, configDriven } = tiersOf(responses, profile);

    for (const legacyResult of legacy) {
      const match = configDriven.find((r) => r.condition === legacyResult.condition);
      expect(match).toBeDefined();
      expect(match?.tier).toBe(legacyResult.tier);
    }
    // Same set of applicable conditions on both sides (sex-gating parity).
    expect(configDriven.map((r) => r.condition).sort()).toEqual(legacy.map((r) => r.condition).sort());
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { computeRiskTiers, type RiskScoringProfile } from "./risk-scoring";
import { computeRiskFromConfig, type RiskQuestionnaireConfigPayload } from "./risk-questionnaire-engine";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";

/**
 * Proves the config-driven engine reproduces risk-scoring.ts's hardcoded
 * CONDITION_RULES exactly, tier-for-tier, across the same scenarios
 * risk-scoring.test.ts covers. Loads the seeded config straight out of its
 * migration (the actual $config$...$config$ jsonb literal, not a hand-copied
 * TS re-transcription) so there is exactly one source of truth for what a
 * given version contains — a typo in either the SQL or a separate TS
 * fixture could otherwise drift unnoticed.
 *
 * Pinned to v2 (20260913200833_risk_questionnaire_configs_v2_add_ckd.sql),
 * not v1: v1 is a frozen, byte-for-byte port of the hardcoded engine AS IT
 * STOOD on 2026-08-28 and is deliberately never retroactively edited when
 * the hardcoded engine gains a new condition — see that migration's own
 * "a change means a new version" comment. This file's whole point is
 * "config parity with TODAY's hardcoded engine", so it must track whichever
 * version is the latest full snapshot, not stay pinned to v1 forever.
 */
const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../../supabase/migrations/20260913200833_risk_questionnaire_configs_v2_add_ckd.sql",
);

function loadSeededConfig(): RiskQuestionnaireConfigPayload {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const match = sql.match(/\$config\$\n([\s\S]*?)\n\$config\$::jsonb/);
  if (!match) {
    throw new Error(`Could not find $config$...$config$ jsonb literal in ${MIGRATION_PATH}`);
  }
  return JSON.parse(match[1]) as RiskQuestionnaireConfigPayload;
}

const PREVENTION_INTAKE_V2 = loadSeededConfig();

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
  const configDriven = computeRiskFromConfig(PREVENTION_INTAKE_V2, responses as unknown as Record<string, unknown>, profile);
  return { legacy, configDriven };
}

describe("seeded v2 config structure", () => {
  it("ports all 8 legacy conditions (7 original + ckd) and all 22 legacy questions", () => {
    expect(PREVENTION_INTAKE_V2.conditions).toHaveLength(8);
    expect(PREVENTION_INTAKE_V2.questions).toHaveLength(22);
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
    ["ckd: family diabetes + family hypertension + age 60+", { family_diabetes: true, family_hypertension: true }, { ageYears: 62 }],
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

import { describe, expect, it } from "@jest/globals";
import {
  computeRiskFromConfig,
  getApplicableQuestions,
  getNextApplicableQuestion,
  isQuestionnaireComplete,
  type QuestionnaireProfile,
  type RiskQuestionnaireConfigPayload,
} from "./risk-questionnaire-engine";

const config: RiskQuestionnaireConfigPayload = {
  questions: [
    {
      key: "smoking_status",
      category: "lifestyle",
      prompt: "Do you smoke?",
      input_type: "single_select",
      options: [
        { value: "never", label: "Never" },
        { value: "current", label: "Current" },
      ],
      required: true,
      order_index: 1,
    },
    {
      key: "cigarettes_per_day",
      category: "lifestyle",
      prompt: "How many a day?",
      input_type: "single_select",
      required: true,
      order_index: 2,
      applicability: { op: "eq", field: "smoking_status", value: "current" },
    },
    {
      key: "family_hypertension",
      category: "family_history",
      prompt: "Family history of hypertension?",
      input_type: "boolean",
      required: true,
      order_index: 3,
    },
  ],
  conditions: [
    {
      condition: "hypertension",
      sex_applicability: null,
      forced_high_predicate: { op: "includes", field: "existing_diagnoses", value: "hypertension" },
      moderate_threshold: 2,
      high_threshold: 4,
      relevant_question_keys: ["smoking_status", "cigarettes_per_day", "family_hypertension"],
      factors: [
        { key: "smoker", points: 2, predicate: { op: "eq", field: "smoking_status", value: "current" } },
        { key: "family_history", points: 2, predicate: { op: "eq", field: "family_hypertension", value: true } },
      ],
    },
    {
      condition: "breast_ca",
      sex_applicability: "female",
      moderate_threshold: 1,
      high_threshold: 3,
      relevant_question_keys: ["family_hypertension"],
      factors: [{ key: "x", points: 1, predicate: { op: "true" } }],
    },
  ],
};

const profile: QuestionnaireProfile = { sex: "female", ageYears: 40, weightKg: 60 };

describe("getApplicableQuestions / getNextApplicableQuestion (branching)", () => {
  it("omits cigarettes_per_day until smoking_status is answered 'current'", () => {
    const applicable = getApplicableQuestions(config, {}, profile);
    expect(applicable.map((q) => q.key)).toEqual(["smoking_status", "family_hypertension"]);
  });

  it("adds cigarettes_per_day once smoking_status is 'current'", () => {
    const applicable = getApplicableQuestions(config, { smoking_status: "current" }, profile);
    expect(applicable.map((q) => q.key)).toContain("cigarettes_per_day");
  });

  it("drives a one-at-a-time flow via getNextApplicableQuestion", () => {
    expect(getNextApplicableQuestion(config, {}, profile)?.key).toBe("smoking_status");
    expect(getNextApplicableQuestion(config, { smoking_status: "never" }, profile)?.key).toBe("family_hypertension");
    expect(
      getNextApplicableQuestion(config, { smoking_status: "never", family_hypertension: false }, profile),
    ).toBeNull();
  });

  it("isQuestionnaireComplete reflects branching, not raw answer count", () => {
    expect(isQuestionnaireComplete(config, { smoking_status: "never" }, profile)).toBe(false);
    expect(
      isQuestionnaireComplete(config, { smoking_status: "never", family_hypertension: true }, profile),
    ).toBe(true);
  });
});

describe("computeRiskFromConfig", () => {
  it("emits 'unknown'/'low' confidence for a sex-specific condition with no sex on file", () => {
    const results = computeRiskFromConfig(config, { smoking_status: "never", family_hypertension: false }, {
      ...profile,
      sex: null,
    });
    const breast = results.find((r) => r.condition === "breast_ca");
    expect(breast?.tier).toBe("unknown");
    expect(breast?.confidence).toBe("low");
  });

  it("skips (does not emit) a sex-specific condition genuinely inapplicable to this patient", () => {
    const results = computeRiskFromConfig(config, {}, { ...profile, sex: "male" });
    expect(results.some((r) => r.condition === "breast_ca")).toBe(false);
  });

  it("forces high tier + high confidence on a matching existing diagnosis, regardless of other answers", () => {
    const results = computeRiskFromConfig(config, { existing_diagnoses: ["hypertension"] }, profile);
    const htn = results.find((r) => r.condition === "hypertension");
    expect(htn?.tier).toBe("high");
    expect(htn?.confidence).toBe("high");
  });

  it("downgrades an almost-entirely-unanswered condition to 'unknown' instead of defaulting to 'low'", () => {
    // Nothing answered at all for hypertension's 3 relevant questions.
    const results = computeRiskFromConfig(config, {}, profile);
    const htn = results.find((r) => r.condition === "hypertension");
    expect(htn?.tier).toBe("unknown");
    expect(htn?.confidence).toBe("low");
  });

  it("computes a real tier with full data, confidence 'high' when every relevant question is answered", () => {
    const results = computeRiskFromConfig(
      config,
      { smoking_status: "never", cigarettes_per_day: undefined, family_hypertension: false },
      profile,
    );
    const htn = results.find((r) => r.condition === "hypertension");
    expect(htn?.tier).toBe("low");
    expect(htn?.confidence).toBe("high");
  });

  it("computes moderate confidence when 2 of 3 in-scope relevant questions are answered", () => {
    // smoking_status="current" brings cigarettes_per_day into scope (3 in-scope
    // keys total); family_hypertension is left unanswered -> 2/3 answered.
    const results = computeRiskFromConfig(
      config,
      { smoking_status: "current", cigarettes_per_day: "20_plus" },
      profile,
    );
    const htn = results.find((r) => r.condition === "hypertension");
    expect(htn?.confidence).toBe("moderate");
  });

  it("does not count a branched-out (inapplicable) question against confidence", () => {
    // cigarettes_per_day is out of scope while smoking_status="never", so the
    // denominator is 2 (smoking_status, family_hypertension), both answered.
    const results = computeRiskFromConfig(
      config,
      { smoking_status: "never", family_hypertension: false },
      profile,
    );
    const htn = results.find((r) => r.condition === "hypertension");
    expect(htn?.confidence).toBe("high");
  });

  it("computes moderate tier when factor points meet the moderate but not the high threshold", () => {
    const results = computeRiskFromConfig(
      config,
      { smoking_status: "current", cigarettes_per_day: "1_5", family_hypertension: false },
      profile,
    );
    const htn = results.find((r) => r.condition === "hypertension");
    expect(htn?.tier).toBe("moderate");
  });
});

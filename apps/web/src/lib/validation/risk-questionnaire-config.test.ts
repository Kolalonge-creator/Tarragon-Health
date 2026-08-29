import { describe, expect, it } from "@jest/globals";
import { riskQuestionnaireConfigJsonSchema, riskQuestionnaireConfigSchema } from "./risk-questionnaire-config";

const VALID_CONFIG = {
  questions: [
    { key: "smoking_status", category: "lifestyle", prompt: "Do you smoke?", input_type: "boolean", required: true, order_index: 1 },
  ],
  conditions: [
    {
      condition: "hypertension",
      sex_applicability: null,
      moderate_threshold: 2,
      high_threshold: 5,
      relevant_question_keys: ["smoking_status"],
      factors: [{ key: "smoker", points: 2, predicate: { op: "eq", field: "smoking_status", value: true } }],
    },
  ],
};

describe("riskQuestionnaireConfigSchema", () => {
  it("accepts a well-formed config", () => {
    expect(riskQuestionnaireConfigSchema.safeParse(VALID_CONFIG).success).toBe(true);
  });

  it("accepts nested and/or/not predicates", () => {
    const withCompound = {
      ...VALID_CONFIG,
      conditions: [
        {
          ...VALID_CONFIG.conditions[0],
          forced_high_predicate: {
            op: "and",
            clauses: [
              { op: "eq", field: "a", value: 1 },
              { op: "not", clause: { op: "in", field: "b", value: [1, 2] } },
            ],
          },
        },
      ],
    };
    expect(riskQuestionnaireConfigSchema.safeParse(withCompound).success).toBe(true);
  });

  it("rejects an unrecognised predicate op", () => {
    const bad = {
      ...VALID_CONFIG,
      conditions: [
        { ...VALID_CONFIG.conditions[0], factors: [{ key: "x", points: 1, predicate: { op: "eval", code: "1+1" } }] },
      ],
    };
    expect(riskQuestionnaireConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a condition with high_threshold below moderate_threshold", () => {
    const bad = {
      ...VALID_CONFIG,
      conditions: [{ ...VALID_CONFIG.conditions[0], moderate_threshold: 5, high_threshold: 2 }],
    };
    expect(riskQuestionnaireConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate question keys", () => {
    const bad = {
      ...VALID_CONFIG,
      questions: [...VALID_CONFIG.questions, VALID_CONFIG.questions[0]],
    };
    expect(riskQuestionnaireConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a config with zero conditions", () => {
    expect(riskQuestionnaireConfigSchema.safeParse({ questions: [], conditions: [] }).success).toBe(false);
  });
});

describe("riskQuestionnaireConfigJsonSchema (the admin editor's form schema)", () => {
  it("accepts valid JSON that parses to a well-formed config", () => {
    const result = riskQuestionnaireConfigJsonSchema.safeParse({
      notes: "Initial version",
      configJson: JSON.stringify(VALID_CONFIG),
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const result = riskQuestionnaireConfigJsonSchema.safeParse({
      notes: "Initial version",
      configJson: "{not valid json",
    });
    expect(result.success).toBe(false);
  });

  it("rejects well-formed JSON that doesn't match the config shape", () => {
    const result = riskQuestionnaireConfigJsonSchema.safeParse({
      notes: "Initial version",
      configJson: JSON.stringify({ hello: "world" }),
    });
    expect(result.success).toBe(false);
  });
});

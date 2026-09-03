import { describe, expect, it } from "@jest/globals";
import { createPatientGoalSchema, logGoalProgressSchema } from "./patient-goal";

describe("createPatientGoalSchema", () => {
  it("accepts a minimal goal (just type + description)", () => {
    const result = createPatientGoalSchema.safeParse({
      goal_type: "walk_more",
      description: "Walk 5,000 steps a day",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional numeric target coerced from a form string", () => {
    const result = createPatientGoalSchema.safeParse({
      goal_type: "walk_more",
      description: "Walk 5,000 steps a day",
      target_value: "5000",
      target_unit: "steps/day",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target_value).toBe(5000);
    }
  });

  it("rejects an unknown goal_type", () => {
    const result = createPatientGoalSchema.safeParse({
      goal_type: "run_a_marathon",
      description: "Something",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty description", () => {
    const result = createPatientGoalSchema.safeParse({ goal_type: "custom", description: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a description over 300 characters", () => {
    const result = createPatientGoalSchema.safeParse({
      goal_type: "custom",
      description: "a".repeat(301),
    });
    expect(result.success).toBe(false);
  });

  it("treats an empty-string target_value from an untouched form field as absent, not zero", () => {
    const result = createPatientGoalSchema.safeParse({
      goal_type: "walk_more",
      description: "Walk more",
      target_value: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target_value).toBe("");
    }
  });
});

describe("logGoalProgressSchema", () => {
  it("accepts a valid progress entry", () => {
    const result = logGoalProgressSchema.safeParse({
      goal_id: "11111111-1111-4111-8111-111111111111",
      logged_date: "2026-08-28",
      value: "5300",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe(5300);
    }
  });

  it("rejects a malformed date", () => {
    const result = logGoalProgressSchema.safeParse({
      goal_id: "11111111-1111-4111-8111-111111111111",
      logged_date: "28-08-2026",
      value: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative value", () => {
    const result = logGoalProgressSchema.safeParse({
      goal_id: "11111111-1111-4111-8111-111111111111",
      logged_date: "2026-08-28",
      value: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid goal_id", () => {
    const result = logGoalProgressSchema.safeParse({
      goal_id: "not-a-uuid",
      logged_date: "2026-08-28",
      value: 10,
    });
    expect(result.success).toBe(false);
  });
});

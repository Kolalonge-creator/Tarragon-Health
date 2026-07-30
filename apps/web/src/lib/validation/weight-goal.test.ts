import { describe, expect, it } from "@jest/globals";
import { weightGoalSchema } from "./weight-goal";

describe("weightGoalSchema", () => {
  it("accepts a valid starting/goal weight pair", () => {
    const result = weightGoalSchema.safeParse({
      starting_weight_kg: 92.5,
      goal_weight_kg: 80,
    });
    expect(result.success).toBe(true);
  });

  it("coerces form-string input to numbers, matching how the <form action> submits it", () => {
    const result = weightGoalSchema.safeParse({
      starting_weight_kg: "92.5",
      goal_weight_kg: "80",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.starting_weight_kg).toBe(92.5);
      expect(result.data.goal_weight_kg).toBe(80);
    }
  });

  it("rejects zero or negative weights", () => {
    expect(
      weightGoalSchema.safeParse({ starting_weight_kg: 0, goal_weight_kg: 80 }).success
    ).toBe(false);
    expect(
      weightGoalSchema.safeParse({ starting_weight_kg: -5, goal_weight_kg: 80 }).success
    ).toBe(false);
  });

  it("rejects a weight above the 400kg ceiling", () => {
    const result = weightGoalSchema.safeParse({
      starting_weight_kg: 401,
      goal_weight_kg: 80,
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 400kg (the ceiling is inclusive)", () => {
    const result = weightGoalSchema.safeParse({
      starting_weight_kg: 400,
      goal_weight_kg: 80,
    });
    expect(result.success).toBe(true);
  });

  it("does not require goal_weight_kg to be below starting_weight_kg — gaining is a valid goal too", () => {
    const result = weightGoalSchema.safeParse({
      starting_weight_kg: 60,
      goal_weight_kg: 70,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing field", () => {
    const result = weightGoalSchema.safeParse({ starting_weight_kg: 80 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric string", () => {
    const result = weightGoalSchema.safeParse({
      starting_weight_kg: "not a number",
      goal_weight_kg: 80,
    });
    expect(result.success).toBe(false);
  });
});

import {
  nutritionLogSchema,
  nutritionConfirmSchema,
  nutritionReferralRequestSchema,
  budgetAlternativeQuerySchema,
  mealPlanRequestSchema,
} from "./nutrition";

describe("nutritionLogSchema", () => {
  it("accepts a meal type with no photo or description", () => {
    const parsed = nutritionLogSchema.safeParse({ meal_type: "lunch" });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown meal type", () => {
    const parsed = nutritionLogSchema.safeParse({ meal_type: "brunch" });
    expect(parsed.success).toBe(false);
  });

  it("treats empty strings as absent via nullish", () => {
    const parsed = nutritionLogSchema.safeParse({
      meal_type: "snack",
      description: "  ",
    });
    // trimmed to "" which is still a string; ensure it parses without throwing
    expect(parsed.success).toBe(true);
  });
});

describe("nutritionConfirmSchema", () => {
  it("requires a uuid entry_id", () => {
    expect(nutritionConfirmSchema.safeParse({ entry_id: "nope" }).success).toBe(false);
  });

  it("coerces a numeric carb override within range", () => {
    const parsed = nutritionConfirmSchema.safeParse({
      entry_id: "11111111-1111-4111-8111-111111111111",
      confirmed_carbs_g: "45",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.confirmed_carbs_g).toBe(45);
  });

  it("rejects an out-of-range carb override", () => {
    const parsed = nutritionConfirmSchema.safeParse({
      entry_id: "11111111-1111-4111-8111-111111111111",
      confirmed_carbs_g: 5000,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("nutritionReferralRequestSchema", () => {
  it("accepts an empty request — no fields are required", () => {
    expect(nutritionReferralRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an optional note within the length limit", () => {
    const parsed = nutritionReferralRequestSchema.safeParse({ note: "Struggling with portion sizes" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a note over 500 characters", () => {
    const parsed = nutritionReferralRequestSchema.safeParse({ note: "x".repeat(501) });
    expect(parsed.success).toBe(false);
  });
});

describe("budgetAlternativeQuerySchema", () => {
  it("requires a non-empty food_query", () => {
    expect(budgetAlternativeQuerySchema.safeParse({ food_query: "" }).success).toBe(false);
  });

  it("accepts a normal query", () => {
    const parsed = budgetAlternativeQuerySchema.safeParse({ food_query: "I cannot afford salmon" });
    expect(parsed.success).toBe(true);
  });
});

describe("mealPlanRequestSchema", () => {
  it("accepts an empty request — both fields are optional", () => {
    expect(mealPlanRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a valid budget tier and preferences note", () => {
    const parsed = mealPlanRequestSchema.safeParse({
      budget_tier: "budget",
      preferences_note: "no seafood please",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown budget tier", () => {
    expect(mealPlanRequestSchema.safeParse({ budget_tier: "luxury" }).success).toBe(false);
  });

  it("rejects a preferences note over 300 characters", () => {
    expect(mealPlanRequestSchema.safeParse({ preferences_note: "x".repeat(301) }).success).toBe(false);
  });
});

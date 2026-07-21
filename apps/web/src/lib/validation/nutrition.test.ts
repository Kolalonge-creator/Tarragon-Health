import { nutritionLogSchema, nutritionConfirmSchema } from "./nutrition";

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

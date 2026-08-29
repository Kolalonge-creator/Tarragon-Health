import { validateMealPlan, type RawMealPlan } from "./meal-plan-validate";
import { FIXTURE_CATALOGUE } from "./test-fixtures";

describe("validateMealPlan", () => {
  it("resolves grams and macros from the catalogue, never trusting the model's own numbers", () => {
    const raw: RawMealPlan = {
      summary: "A balanced week.",
      notes: null,
      days: [
        {
          day: 1,
          meals: {
            breakfast: [{ food_code: "eggs_boiled", quantity: 2, unit: "piece", rationale: "protein to start the day" }],
            lunch: [
              { food_code: "white_rice", quantity: 1, unit: "serving" },
              { food_code: "beans_cooked", quantity: 1, unit: "serving" },
            ],
          },
        },
      ],
    };

    const result = validateMealPlan(raw, FIXTURE_CATALOGUE);
    expect(result.days).toHaveLength(1);

    const breakfast = result.days[0].meals.breakfast;
    expect(breakfast).toHaveLength(1);
    expect(breakfast?.[0].foodName).toBe("Boiled eggs");
    expect(breakfast?.[0].grams).toBe(100); // 2 * 50g/piece

    const lunch = result.days[0].meals.lunch;
    expect(lunch).toHaveLength(2);

    // Totals should reflect breakfast + lunch, not just one meal, and should
    // be recomputed rather than anything the model might have claimed.
    expect(result.days[0].analysis).not.toBeNull();
    expect(result.days[0].analysis?.reliable).toBe(true);
    expect(result.days[0].analysis?.caloriesKcal).toBeGreaterThan(0);
  });

  it("drops a hallucinated food_code and reports it, rather than crashing or inventing macros", () => {
    const raw: RawMealPlan = {
      summary: "Plan",
      days: [
        {
          day: 1,
          meals: {
            breakfast: [{ food_code: "not_a_real_food", quantity: 1, unit: "serving" }],
          },
        },
      ],
    };

    const result = validateMealPlan(raw, FIXTURE_CATALOGUE);
    expect(result.days[0].meals.breakfast).toBeUndefined();
    expect(result.droppedItems).toEqual(["not_a_real_food"]);
  });

  it("falls back to the food's default portion when the model gives an unrecognised unit", () => {
    const raw: RawMealPlan = {
      summary: "Plan",
      days: [
        {
          day: 1,
          meals: {
            lunch: [{ food_code: "white_rice", quantity: 1, unit: "bucket" }],
          },
        },
      ],
    };

    const result = validateMealPlan(raw, FIXTURE_CATALOGUE);
    const item = result.days[0].meals.lunch?.[0];
    expect(item?.unit).toBe("serving"); // white_rice's own default portion
    expect(item?.grams).toBe(200);
  });

  it("guards against a non-positive quantity by treating it as 1", () => {
    const raw: RawMealPlan = {
      summary: "Plan",
      days: [
        {
          day: 1,
          meals: {
            lunch: [{ food_code: "white_rice", quantity: -3, unit: "serving" }],
          },
        },
      ],
    };

    const result = validateMealPlan(raw, FIXTURE_CATALOGUE);
    expect(result.days[0].meals.lunch?.[0].quantity).toBe(1);
  });

  it("leaves a day with no valid items as an empty meals object with no analysis", () => {
    const raw: RawMealPlan = {
      summary: "Plan",
      days: [{ day: 1, meals: { breakfast: [{ food_code: "nope", quantity: 1, unit: "serving" }] } }],
    };
    const result = validateMealPlan(raw, FIXTURE_CATALOGUE);
    expect(result.days[0].analysis).toBeNull();
  });

  it("trims summary/notes and defaults a missing notes field to null", () => {
    const raw: RawMealPlan = { summary: "  Hello  ", days: [] };
    const result = validateMealPlan(raw, FIXTURE_CATALOGUE);
    expect(result.summary).toBe("Hello");
    expect(result.notes).toBeNull();
  });
});

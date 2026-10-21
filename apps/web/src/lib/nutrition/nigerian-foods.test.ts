import {
  NIGERIAN_FOOD_REFERENCE,
  foodGroundingText,
  summariseCatalogueReference,
  summariseFoodReference,
} from "./nigerian-foods";

describe("nigerian-foods reference set", () => {
  it("has a non-trivial number of staples", () => {
    expect(NIGERIAN_FOOD_REFERENCE.length).toBeGreaterThanOrEqual(20);
  });

  it("gives every entry a name and a sane carb figure", () => {
    for (const food of NIGERIAN_FOOD_REFERENCE) {
      expect(food.name.trim().length).toBeGreaterThan(0);
      expect(food.typicalCarbsPerServingG).toBeGreaterThanOrEqual(0);
      expect(food.typicalCarbsPerServingG).toBeLessThanOrEqual(100);
    }
  });

  it("summary mentions a well-known staple and its alias", () => {
    const summary = summariseFoodReference();
    expect(summary).toContain("Jollof rice");
    expect(summary).toContain("garri");
    expect(summary).toContain("g carbs/serving");
  });
});

describe("catalogue grounding (S49a)", () => {
  const catalogue = Array.from({ length: 25 }, (_, i) => ({
    name: `Dish ${i}`,
    aliases: i === 0 ? ["a", "b", "c", "d"] : [],
    carbsG100g: 20,
    portions: [{ grams: 250, isDefault: true }],
  }));

  it("computes carbs per default serving from the table row", () => {
    const text = foodGroundingText(catalogue);
    expect(text).toContain("Dish 1: ~50g carbs/serving");
    expect(text).toContain("(also: a, b, c)");
    expect(text).not.toContain("also: a, b, c, d");
  });
  it("falls back to the hand-kept list when the table is unreadable or tiny", () => {
    expect(foodGroundingText(null)).toBe(summariseFoodReference());
    expect(foodGroundingText(undefined)).toBe(summariseFoodReference());
    expect(foodGroundingText(catalogue.slice(0, 3))).toBe(summariseFoodReference());
  });
  it("skips a food with no portion rather than inventing a serving size", () => {
    expect(summariseCatalogueReference([{ name: "NoPortion", aliases: [], carbsG100g: 10, portions: [] }])).toBe("");
  });
});

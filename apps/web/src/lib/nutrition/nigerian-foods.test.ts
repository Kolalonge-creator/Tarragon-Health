import {
  NIGERIAN_FOOD_REFERENCE,
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

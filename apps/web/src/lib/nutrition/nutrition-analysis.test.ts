import { parseFoodText } from "./food-parser";
import { analyseNutrition } from "./nutrition-analysis";
import { FIXTURE_CATALOGUE } from "./test-fixtures";

describe("analyseNutrition", () => {
  it("returns null for no items", () => {
    expect(analyseNutrition([], FIXTURE_CATALOGUE)).toBeNull();
  });

  it("sums macros scaled by grams for fully-matched items", () => {
    const items = parseFoodText("rice, beans", FIXTURE_CATALOGUE);
    const result = analyseNutrition(items, FIXTURE_CATALOGUE);
    expect(result).not.toBeNull();
    // white_rice default 200g serving @ 130kcal/100g = 260; beans 150g @130kcal/100g = 195
    expect(result?.caloriesKcal).toBeCloseTo(260 + 195, 1);
    expect(result?.matchedCount).toBe(2);
    expect(result?.unmatchedCount).toBe(0);
    expect(result?.reliable).toBe(true);
  });

  it("marks the analysis unreliable and excludes unmatched items from totals", () => {
    const items = parseFoodText("rice and some unknown alien food", FIXTURE_CATALOGUE);
    const result = analyseNutrition(items, FIXTURE_CATALOGUE);
    expect(result?.matchedCount).toBe(1);
    expect(result?.unmatchedCount).toBe(1);
    expect(result?.reliable).toBe(false);
    // Only rice's macros should be counted, not zeroed-out for the unmatched item.
    expect(result?.caloriesKcal).toBeCloseTo(260, 1);
  });

  it("flags a high-sodium food (dried fish) above a typical serving of grilled chicken", () => {
    // Compare two proteins so the difference reflects sodium density, not
    // wildly different default portion sizes across food categories.
    const highSodium = analyseNutrition(parseFoodText("stockfish", FIXTURE_CATALOGUE), FIXTURE_CATALOGUE);
    const lowerSodium = analyseNutrition(parseFoodText("chicken", FIXTURE_CATALOGUE), FIXTURE_CATALOGUE);
    expect(highSodium!.sodiumMg).toBeGreaterThan(lowerSodium!.sodiumMg);
  });
});

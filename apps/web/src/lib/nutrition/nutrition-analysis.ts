import type { FoodCatalogueItem } from "./food-catalogue";
import type { ParsedFoodItem } from "./food-parser";

/**
 * Nutrition analysis (spec 19.5): sums calories/carbs/protein/fat/fibre/
 * sodium from matched, catalogue-priced items only. Unmatched items are
 * excluded from the totals and counted separately — the result says plainly
 * when it isn't the whole picture, rather than presenting a partial total as
 * complete. Coaching guidance only, same convention as the rest of this
 * table — never a clinical measurement.
 */

export interface NutritionAnalysisResult {
  caloriesKcal: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fibreG: number;
  sodiumMg: number;
  /** True only when every item parsed out of the text was matched to the
   * catalogue — i.e. the totals reflect the whole logged meal. */
  reliable: boolean;
  matchedCount: number;
  unmatchedCount: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function analyseNutrition(
  items: readonly ParsedFoodItem[],
  catalogue: readonly FoodCatalogueItem[],
): NutritionAnalysisResult | null {
  if (items.length === 0) return null;

  const byCode = new Map(catalogue.map((f) => [f.code, f]));
  let caloriesKcal = 0;
  let carbsG = 0;
  let proteinG = 0;
  let fatG = 0;
  let fibreG = 0;
  let sodiumMg = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const item of items) {
    const food = item.foodCode ? byCode.get(item.foodCode) : undefined;
    if (!item.matched || !food || item.grams == null) {
      unmatchedCount += 1;
      continue;
    }
    matchedCount += 1;
    const factor = item.grams / 100;
    caloriesKcal += food.caloriesKcal100g * factor;
    carbsG += food.carbsG100g * factor;
    proteinG += food.proteinG100g * factor;
    fatG += food.fatG100g * factor;
    fibreG += food.fibreG100g * factor;
    sodiumMg += food.sodiumMg100g * factor;
  }

  return {
    caloriesKcal: round1(caloriesKcal),
    carbsG: round1(carbsG),
    proteinG: round1(proteinG),
    fatG: round1(fatG),
    fibreG: round1(fibreG),
    sodiumMg: round1(sodiumMg),
    reliable: unmatchedCount === 0 && matchedCount > 0,
    matchedCount,
    unmatchedCount,
  };
}

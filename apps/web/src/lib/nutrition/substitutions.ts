import { matchFood, type ParsedFoodItem } from "./food-parser";
import type { FoodCatalogueItem, FoodCostTier, NigerianFoodCategory } from "./food-catalogue";

/**
 * Food substitution engine (spec 19.7) and budget-aware alternatives (spec
 * 19.9). Always frames a swap as "smaller portion / pair with X / try Y
 * instead" — never "don't eat X" — and, for a budget ask like "I cannot
 * afford salmon", finds a same-role, locally-available, cheaper option
 * rather than refusing to answer just because the named food isn't Nigerian.
 *
 * Pure module — the catalogue is passed in, so this is unit-testable.
 */

export type SubstitutionConcern = "sodium" | "carbs" | "general";

export interface SubstitutionSuggestion {
  message: string;
  alternativeFoodCodes: string[];
}

const COST_RANK: Record<FoodCostTier, number> = { budget: 0, mid: 1, premium: 2 };

/** A handful of commonly-referenced non-Nigerian/aspirational foods, mapped
 * to the local food group they'd occupy on the plate — so "I can't afford
 * salmon" still gets a useful, locally-available answer (spec 19.9's own
 * example) even though salmon itself isn't in the Nigerian food catalogue. */
const FOREIGN_FOOD_HINTS: Record<string, { category: NigerianFoodCategory; note: string }> = {
  salmon: { category: "protein", note: "an imported fish" },
  quinoa: { category: "staple", note: "an imported grain" },
  oats: { category: "staple", note: "an imported grain" },
};

function pluraliseVerb(count: number, singular: string, plural: string): string {
  return count > 1 ? plural : singular;
}

function namesList(foods: readonly FoodCatalogueItem[]): string {
  return foods.map((f) => f.name).join(" or ");
}

function pickAlternatives(
  food: FoodCatalogueItem,
  concern: SubstitutionConcern,
  budgetConstrained: boolean,
  catalogue: readonly FoodCatalogueItem[],
): FoodCatalogueItem[] {
  let pool = catalogue.filter((f) => f.category === food.category && f.code !== food.code);
  if (budgetConstrained) {
    pool = pool.filter((f) => COST_RANK[f.costTier] <= COST_RANK[food.costTier]);
  }

  let sorted: FoodCatalogueItem[];
  if (concern === "sodium") {
    sorted = pool
      .filter((f) => f.sodiumMg100g < food.sodiumMg100g)
      .sort((a, b) => a.sodiumMg100g - b.sodiumMg100g);
  } else if (concern === "carbs") {
    sorted = pool
      .filter((f) => f.carbsG100g < food.carbsG100g)
      .sort((a, b) => a.carbsG100g - b.carbsG100g);
  } else {
    sorted = [...pool].sort((a, b) => COST_RANK[a.costTier] - COST_RANK[b.costTier]);
  }
  return sorted.slice(0, 2);
}

/** Suggest a realistic swap for one already-identified catalogue food. */
export function suggestSubstitution(params: {
  foodCode: string;
  concern: SubstitutionConcern;
  budgetConstrained?: boolean;
  catalogue: readonly FoodCatalogueItem[];
}): SubstitutionSuggestion | null {
  const food = params.catalogue.find((f) => f.code === params.foodCode);
  if (!food) return null;

  const budgetConstrained = params.budgetConstrained ?? false;
  const alternatives = pickAlternatives(food, params.concern, budgetConstrained, params.catalogue);

  const portionLine = `Consider a smaller portion of ${food.name.toLowerCase()} and add extra vegetables or protein.`;
  let extra = "";
  if (alternatives.length > 0) {
    const names = namesList(alternatives);
    const verb = pluraliseVerb(alternatives.length, "tends", "tend");
    if (budgetConstrained) {
      const be = pluraliseVerb(alternatives.length, "is", "are");
      extra = ` If cost is a factor, ${names} ${be} a more budget-friendly option with a similar role on the plate.`;
    } else if (params.concern === "sodium") {
      extra = ` You could also try ${names}, which ${verb} to be lower in salt.`;
    } else if (params.concern === "carbs") {
      extra = ` You could also try ${names}, which ${verb} to be lower in carbs.`;
    }
  }

  return { message: portionLine + extra, alternativeFoodCodes: alternatives.map((a) => a.code) };
}

/**
 * Budget-aware substitution from free text (spec 19.9): "I cannot afford
 * X". Tries to recognise X in the Nigerian food catalogue first, then falls
 * back to a small set of commonly-referenced imported/aspirational foods.
 * Returns null when neither recognises the food — communicating "we don't
 * have a specific suggestion for that" rather than guessing.
 */
export function suggestBudgetAlternative(
  foodNameOrPhrase: string,
  catalogue: readonly FoodCatalogueItem[],
): SubstitutionSuggestion | null {
  const match = matchFood(foodNameOrPhrase, catalogue);
  if (match) {
    return suggestSubstitution({
      foodCode: match.food.code,
      concern: "general",
      budgetConstrained: true,
      catalogue,
    });
  }

  const normalised = foodNameOrPhrase.trim().toLowerCase();
  const hint = Object.entries(FOREIGN_FOOD_HINTS).find(([key]) => normalised.includes(key));
  if (!hint) return null;
  const [name, { category, note }] = hint;

  const alternatives = catalogue
    .filter((f) => f.category === category && f.costTier === "budget")
    .sort((a, b) => COST_RANK[a.costTier] - COST_RANK[b.costTier])
    .slice(0, 3);
  if (alternatives.length === 0) return null;

  const names = namesList(alternatives);
  return {
    message: `${name[0].toUpperCase()}${name.slice(1)} is ${note} that isn't always available or affordable locally. ${names} are good local, budget-friendly alternatives that fill a similar role on the plate.`,
    alternativeFoodCodes: alternatives.map((a) => a.code),
  };
}

/**
 * Which matched item in a logged meal contributed the most of a given
 * nutrient — the natural thing to offer a substitution for, rather than
 * picking arbitrarily among several logged items.
 */
export function pickDominantContributor(
  items: readonly ParsedFoodItem[],
  catalogue: readonly FoodCatalogueItem[],
  metric: "sodium" | "carbs",
): string | null {
  const byCode = new Map(catalogue.map((f) => [f.code, f]));
  let bestCode: string | null = null;
  let bestAmount = 0;

  for (const item of items) {
    if (!item.matched || !item.foodCode || item.grams == null) continue;
    const food = byCode.get(item.foodCode);
    if (!food) continue;
    const per100g = metric === "sodium" ? food.sodiumMg100g : food.carbsG100g;
    const amount = per100g * (item.grams / 100);
    if (amount > bestAmount) {
      bestAmount = amount;
      bestCode = item.foodCode;
    }
  }

  return bestCode;
}

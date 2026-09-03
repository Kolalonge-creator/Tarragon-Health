import type { Enums } from "@tarragon/shared";

/**
 * Shared types for the structured Nigerian food database (spec 19.2/19.3).
 *
 * Distinct from `nigerian-foods.ts` — that file is a small, hardcoded carb
 * cheat-sheet that only grounds the meal-photo vision prompt. This is the
 * real, queryable catalogue backing text-based food logging, full nutrition
 * analysis, condition-specific guidance and the substitution engine. Pure
 * module (no server-only, no network) so parsing/analysis logic built on top
 * of it stays unit-testable with a small fixture catalogue.
 */

export const NIGERIAN_FOOD_CATEGORIES = [
  "staple",
  "swallow",
  "legume",
  "soup",
  "protein",
  "snack_drink",
] as const;
export type NigerianFoodCategory = (typeof NIGERIAN_FOOD_CATEGORIES)[number];
const _categoryCheck: readonly Enums<"nigerian_food_category">[] = NIGERIAN_FOOD_CATEGORIES;
void _categoryCheck;

export const FOOD_PORTION_UNITS = [
  "plate",
  "cup",
  "spoon",
  "handful",
  "piece",
  "serving",
] as const;
export type FoodPortionUnit = (typeof FOOD_PORTION_UNITS)[number];
const _unitCheck: readonly Enums<"food_portion_unit">[] = FOOD_PORTION_UNITS;
void _unitCheck;

export const FOOD_COST_TIERS = ["budget", "mid", "premium"] as const;
export type FoodCostTier = (typeof FOOD_COST_TIERS)[number];
const _costCheck: readonly Enums<"food_cost_tier">[] = FOOD_COST_TIERS;
void _costCheck;

export interface FoodPortionRef {
  unit: FoodPortionUnit;
  grams: number;
  isDefault: boolean;
}

/** One row of the food catalogue, macros per 100g as prepared/served. */
export interface FoodCatalogueItem {
  id: string;
  code: string;
  name: string;
  aliases: string[];
  category: NigerianFoodCategory;
  costTier: FoodCostTier;
  caloriesKcal100g: number;
  carbsG100g: number;
  proteinG100g: number;
  fatG100g: number;
  fibreG100g: number;
  sodiumMg100g: number;
  portions: FoodPortionRef[];
}

/**
 * A patient should never need a weighing scale (spec 19.3). When a food has
 * no explicit portion row for the requested unit, fall back to a sane
 * category-level default so every (food, unit) combination still resolves
 * to *some* gram estimate rather than failing to log at all.
 */
export const CATEGORY_DEFAULT_PORTION_GRAMS: Record<
  NigerianFoodCategory,
  Record<FoodPortionUnit, number>
> = {
  staple: { plate: 250, cup: 150, spoon: 30, handful: 80, piece: 100, serving: 200 },
  swallow: { plate: 250, cup: 150, spoon: 30, handful: 80, piece: 200, serving: 200 },
  legume: { plate: 200, cup: 120, spoon: 25, handful: 75, piece: 30, serving: 150 },
  soup: { plate: 350, cup: 200, spoon: 20, handful: 200, piece: 300, serving: 300 },
  protein: { plate: 150, cup: 100, spoon: 25, handful: 60, piece: 80, serving: 100 },
  snack_drink: { plate: 100, cup: 250, spoon: 15, handful: 40, piece: 50, serving: 100 },
};

/** Grams for a given food+unit: an explicit portion row if one exists, else
 * the food's own default portion, else the category-level fallback. */
export function resolvePortionGrams(food: FoodCatalogueItem, unit: FoodPortionUnit | null): number {
  if (unit) {
    const explicit = food.portions.find((p) => p.unit === unit);
    if (explicit) return explicit.grams;
  }
  const foodDefault = food.portions.find((p) => p.isDefault);
  if (!unit && foodDefault) return foodDefault.grams;
  return CATEGORY_DEFAULT_PORTION_GRAMS[food.category][unit ?? "serving"];
}

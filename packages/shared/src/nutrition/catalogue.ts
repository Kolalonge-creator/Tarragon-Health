import type { Database } from "../database.types";

type Enums<K extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][K];

/**
 * Shared types for the structured Nigerian food database (spec 19.2/19.3, v5 6.1/6.2).
 *
 * Lives in @tarragon/shared (S49a) so the phone and the web read ONE definition of a food, a portion and how a unit becomes
 * grams. Pure module: no network, no server-only, so parsing and analysis built on it stay unit-testable with a small fixture.
 */

export const NIGERIAN_FOOD_CATEGORIES = [
  "staple",
  "swallow",
  "legume",
  "soup",
  "protein",
  "snack_drink",
  "fruit_veg",
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
  "wrap",
  "ladle",
  "bowl",
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
  /** Total sugars per 100 g; null when not known. Never guessed to zero. */
  sugarG100g?: number | null;
  isDrink?: boolean;
  /** Sodium at or above 600 mg per 100 g (1.5 g salt). A flag, not advice. */
  highSalt?: boolean;
  /** Total sugars at or above 22.5 g per 100 g (11.25 for a drink). A flag, not advice. */
  highSugar?: boolean;
  portions: FoodPortionRef[];
}

/**
 * A patient should never need a weighing scale (spec 19.3). When a food has no explicit portion row for the requested
 * unit, fall back to a sane category-level default so every (food, unit) combination still resolves to *some* gram
 * estimate rather than failing to log at all.
 */
export const CATEGORY_DEFAULT_PORTION_GRAMS: Record<NigerianFoodCategory, Record<FoodPortionUnit, number>> = {
  staple: { plate: 250, cup: 150, spoon: 30, handful: 80, piece: 100, serving: 200, wrap: 250, ladle: 100, bowl: 300 },
  swallow: { plate: 250, cup: 150, spoon: 30, handful: 80, piece: 200, serving: 200, wrap: 250, ladle: 100, bowl: 300 },
  legume: { plate: 200, cup: 120, spoon: 25, handful: 75, piece: 30, serving: 150, wrap: 120, ladle: 100, bowl: 250 },
  soup: { plate: 350, cup: 200, spoon: 20, handful: 200, piece: 300, serving: 300, wrap: 300, ladle: 90, bowl: 300 },
  protein: { plate: 150, cup: 100, spoon: 25, handful: 60, piece: 80, serving: 100, wrap: 150, ladle: 80, bowl: 200 },
  snack_drink: { plate: 100, cup: 250, spoon: 15, handful: 40, piece: 50, serving: 100, wrap: 150, ladle: 80, bowl: 200 },
  fruit_veg: { plate: 200, cup: 150, spoon: 20, handful: 80, piece: 120, serving: 120, wrap: 120, ladle: 80, bowl: 200 },
};

/** Grams for a given food+unit: an explicit portion row if one exists, else the food's own default portion, else the category-level fallback. */
export function resolvePortionGrams(food: FoodCatalogueItem, unit: FoodPortionUnit | null): number {
  if (unit) {
    const explicit = food.portions.find((p) => p.unit === unit);
    if (explicit) return explicit.grams;
  }
  const foodDefault = food.portions.find((p) => p.isDefault);
  if (!unit && foodDefault) return foodDefault.grams;
  return CATEGORY_DEFAULT_PORTION_GRAMS[food.category][unit ?? "serving"];
}

/** Plain English for a unit, singular or plural, for the picker and the diary. */
export function portionUnitLabel(unit: FoodPortionUnit, quantity = 1): string {
  const one = quantity === 1;
  switch (unit) {
    case "plate":
      return one ? "plate" : "plates";
    case "cup":
      return one ? "cup" : "cups";
    case "spoon":
      return one ? "spoon" : "spoons";
    case "handful":
      return one ? "handful" : "handfuls";
    case "piece":
      return one ? "piece" : "pieces";
    case "serving":
      return one ? "serving" : "servings";
    case "wrap":
      return one ? "wrap" : "wraps";
    case "ladle":
      return one ? "ladle" : "ladles";
    case "bowl":
      return one ? "bowl" : "bowls";
  }
}

type FoodRow = Database["public"]["Tables"]["nigerian_foods"]["Row"];
type PortionRow = Database["public"]["Tables"]["nigerian_food_portions"]["Row"];

/** The one place a database row becomes a catalogue item, used by the web server, the web browser client and the phone. */
export function buildCatalogue(foods: readonly FoodRow[], portions: readonly Pick<PortionRow, "food_id" | "unit" | "grams" | "is_default">[]): FoodCatalogueItem[] {
  const byFood = new Map<string, FoodPortionRef[]>();
  for (const p of portions) {
    const list = byFood.get(p.food_id) ?? [];
    list.push({ unit: p.unit, grams: p.grams, isDefault: p.is_default });
    byFood.set(p.food_id, list);
  }
  return foods.map((f) => ({
    id: f.id,
    code: f.code,
    name: f.name,
    aliases: f.aliases,
    category: f.category,
    costTier: f.cost_tier,
    caloriesKcal100g: f.calories_kcal_100g,
    carbsG100g: f.carbs_g_100g,
    proteinG100g: f.protein_g_100g,
    fatG100g: f.fat_g_100g,
    fibreG100g: f.fibre_g_100g,
    sodiumMg100g: f.sodium_mg_100g,
    sugarG100g: f.sugar_g_100g,
    isDrink: f.is_drink,
    highSalt: f.high_salt,
    highSugar: f.high_sugar,
    portions: byFood.get(f.id) ?? [],
  }));
}

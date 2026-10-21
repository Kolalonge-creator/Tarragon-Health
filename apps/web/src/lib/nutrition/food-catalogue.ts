// S49a: the food catalogue types and the portion-to-grams rules moved to @tarragon/shared so the phone and the web read one definition.
// This file stays as the web's import path.
export {
  NIGERIAN_FOOD_CATEGORIES,
  FOOD_PORTION_UNITS,
  FOOD_COST_TIERS,
  CATEGORY_DEFAULT_PORTION_GRAMS,
  resolvePortionGrams,
  portionUnitLabel,
  buildCatalogue,
} from "@tarragon/shared";
export type {
  NigerianFoodCategory,
  FoodPortionUnit,
  FoodCostTier,
  FoodPortionRef,
  FoodCatalogueItem,
} from "@tarragon/shared";

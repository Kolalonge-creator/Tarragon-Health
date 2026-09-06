import { MEAL_TYPES } from "@/lib/validation/nutrition";
import {
  resolvePortionGrams,
  FOOD_PORTION_UNITS,
  type FoodCatalogueItem,
  type FoodPortionUnit,
} from "./food-catalogue";
import { analyseNutrition, type NutritionAnalysisResult } from "./nutrition-analysis";
import type { ParsedFoodItem } from "./food-parser";

/**
 * 7-day meal planner (spec 19.8) — validation/recompute layer.
 *
 * The LLM in meal-plan-generate.ts only ever picks food_code + quantity +
 * unit; every gram figure and every nutrition total here is recomputed from
 * the real catalogue, exactly like nutrition-analysis.ts does for a typed
 * meal log — the model's own arithmetic (and any food_code it might
 * hallucinate) is never trusted. Pure module, unit-testable without an AI
 * call.
 */

export type MealPlanSlot = (typeof MEAL_TYPES)[number];

export interface RawMealPlanItem {
  food_code: string;
  quantity: number;
  unit: string;
  rationale?: string | null;
}

export interface RawMealPlanDay {
  day: number;
  meals: Partial<Record<string, RawMealPlanItem[]>>;
}

export interface RawMealPlan {
  days: RawMealPlanDay[];
  summary: string;
  notes?: string | null;
}

export interface MealPlanItem {
  foodCode: string;
  foodName: string;
  quantity: number;
  unit: FoodPortionUnit;
  grams: number;
  rationale: string | null;
}

export interface MealPlanDay {
  day: number;
  meals: Partial<Record<MealPlanSlot, MealPlanItem[]>>;
  analysis: NutritionAnalysisResult | null;
}

export interface ValidatedMealPlan {
  days: MealPlanDay[];
  summary: string;
  notes: string | null;
  /** food_codes the model referenced that don't exist in the catalogue —
   * dropped from the plan, surfaced so a bad generation is visible rather
   * than silently thinned out. */
  droppedItems: string[];
}

function isKnownUnit(unit: string): unit is FoodPortionUnit {
  return (FOOD_PORTION_UNITS as readonly string[]).includes(unit);
}

export function validateMealPlan(
  raw: RawMealPlan,
  catalogue: readonly FoodCatalogueItem[],
): ValidatedMealPlan {
  const byCode = new Map(catalogue.map((f) => [f.code, f]));
  const droppedItems: string[] = [];

  const days: MealPlanDay[] = raw.days.map((rawDay) => {
    const meals: MealPlanDay["meals"] = {};
    const itemsForAnalysis: ParsedFoodItem[] = [];

    for (const slot of MEAL_TYPES) {
      const rawItems = rawDay.meals[slot];
      if (!rawItems || rawItems.length === 0) continue;

      const items: MealPlanItem[] = [];
      for (const rawItem of rawItems) {
        const food = byCode.get(rawItem.food_code);
        if (!food) {
          droppedItems.push(rawItem.food_code);
          continue;
        }

        const requestedUnit = isKnownUnit(rawItem.unit) ? rawItem.unit : null;
        const quantity =
          Number.isFinite(rawItem.quantity) && rawItem.quantity > 0 ? rawItem.quantity : 1;
        const grams = resolvePortionGrams(food, requestedUnit) * quantity;
        const unit =
          requestedUnit ?? food.portions.find((p) => p.isDefault)?.unit ?? "serving";

        items.push({
          foodCode: food.code,
          foodName: food.name,
          quantity,
          unit,
          grams,
          rationale: rawItem.rationale?.trim() || null,
        });

        itemsForAnalysis.push({
          raw: food.name,
          foodCode: food.code,
          foodName: food.name,
          quantity,
          unit: requestedUnit,
          grams,
          matched: true,
          confidence: "high",
        });
      }

      if (items.length > 0) meals[slot] = items;
    }

    return {
      day: rawDay.day,
      meals,
      analysis: analyseNutrition(itemsForAnalysis, catalogue),
    };
  });

  return {
    days,
    summary: raw.summary?.trim() || "",
    notes: raw.notes?.trim() || null,
    droppedItems,
  };
}

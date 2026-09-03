import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { FoodCatalogueItem } from "./food-catalogue";

/**
 * Fetches the full Nigerian food catalogue (foods + portions, two round
 * trips) and assembles it into the shape food-parser.ts/nutrition-
 * analysis.ts expect. Best-effort: never throws — a failed fetch returns an
 * empty catalogue and callers degrade to "couldn't analyse this meal" rather
 * than blocking the log itself (same convention as meal-vision.ts).
 */
export async function fetchFoodCatalogue(
  supabase: SupabaseClient<Database>,
): Promise<FoodCatalogueItem[]> {
  try {
    const [{ data: foods, error: foodsError }, { data: portions, error: portionsError }] =
      await Promise.all([
        supabase.from("nigerian_foods").select("*"),
        supabase.from("nigerian_food_portions").select("*"),
      ]);
    if (foodsError || portionsError || !foods) return [];

    const portionsByFood = new Map<string, FoodCatalogueItem["portions"]>();
    for (const p of portions ?? []) {
      const list = portionsByFood.get(p.food_id) ?? [];
      list.push({ unit: p.unit, grams: p.grams, isDefault: p.is_default });
      portionsByFood.set(p.food_id, list);
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
      portions: portionsByFood.get(f.id) ?? [],
    }));
  } catch (error) {
    console.error("nutrition: food catalogue fetch failed, continuing without it", error);
    return [];
  }
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildCatalogue, type FoodCatalogueItem } from "./food-catalogue";

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

    return buildCatalogue(foods, portions ?? []);
  } catch (error) {
    console.error("nutrition: food catalogue fetch failed, continuing without it", error);
    return [];
  }
}

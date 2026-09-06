import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { FoodCatalogueItem } from "@/lib/nutrition/food-catalogue";

/** The Nigerian food catalogue (spec 19.2/19.3), client-side. Reference data
 * that rarely changes — cached for an hour rather than refetched on every
 * mount. Assembly logic mirrors lib/nutrition/food-catalogue-fetch.ts, kept
 * separate because that one is server-only and this runs in the browser. */
export function useFoodCatalogue() {
  return useQuery({
    queryKey: ["nigerian-food-catalogue"],
    queryFn: async (): Promise<FoodCatalogueItem[]> => {
      const supabase = createClient();
      const [{ data: foods, error: foodsError }, { data: portions, error: portionsError }] =
        await Promise.all([
          supabase.from("nigerian_foods").select("*"),
          supabase.from("nigerian_food_portions").select("*"),
        ]);
      if (foodsError) throw foodsError;
      if (portionsError) throw portionsError;

      const portionsByFood = new Map<string, FoodCatalogueItem["portions"]>();
      for (const p of portions ?? []) {
        const list = portionsByFood.get(p.food_id) ?? [];
        list.push({ unit: p.unit, grams: p.grams, isDefault: p.is_default });
        portionsByFood.set(p.food_id, list);
      }

      return (foods ?? []).map((f) => ({
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
    },
    staleTime: 60 * 60 * 1000,
  });
}

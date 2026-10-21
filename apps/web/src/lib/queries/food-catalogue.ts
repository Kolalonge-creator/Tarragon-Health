import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { buildCatalogue, type FoodCatalogueItem } from "@/lib/nutrition/food-catalogue";

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

      return buildCatalogue(foods ?? [], portions ?? []);
    },
    staleTime: 60 * 60 * 1000,
  });
}

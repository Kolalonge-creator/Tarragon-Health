import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

/** access_duration_days >= 300 reads as "yearly" for UI grouping (every
 * live yearly pack is 365; every monthly one is 30) — a derived label, not
 * a stored column, since service_products has no interval concept of its
 * own (a pack's price/duration already fully describe it). */
export type ServiceProduct = Tables<"service_products"> & { interval: "monthly" | "yearly" };

export const ACTIVE_SERVICE_PRODUCTS_QUERY_KEY = ["service-products", "active"];
export const ALL_SERVICE_PRODUCTS_QUERY_KEY = ["service-products", "all"];

function withInterval(row: Tables<"service_products">): ServiceProduct {
  return { ...row, interval: (row.access_duration_days ?? 0) >= 300 ? "yearly" : "monthly" };
}

/** Every active service product, for patient-facing selection (onboarding,
 * /patient/subscription) — callers filter by currency/tier client-side.
 * service_products is authenticated-readable per its RLS, so this can be
 * called from onboarding before any service_purchases row exists yet. */
export function useActiveServiceProducts() {
  return useQuery({
    queryKey: ACTIVE_SERVICE_PRODUCTS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_products")
        .select("*")
        .eq("is_active", true)
        .order("price_kobo", { ascending: true });
      if (error) throw error;
      return data.map(withInterval);
    },
  });
}

/** Every service product, any currency/active state — admin management view. */
export function useAllServiceProductsAdmin() {
  return useQuery({
    queryKey: ALL_SERVICE_PRODUCTS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_products")
        .select("*")
        .order("price_kobo", { ascending: true });
      if (error) throw error;
      return data.map(withInterval);
    },
  });
}

/** Toggle a product's is_active without touching price/currency/duration. */
export function useSetServiceProductActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("service_products")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_SERVICE_PRODUCTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ACTIVE_SERVICE_PRODUCTS_QUERY_KEY });
    },
  });
}

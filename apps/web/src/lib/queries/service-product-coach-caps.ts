import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const QUERY_KEY = ["service-product-ai-coach-caps"];

/** Scoped to just the AI Coach cap field — not a general product editor
 * (service catalogue management itself is a later sprint per CLAUDE.md).
 * Repointed 2026-08-31 at service_products (see
 * public.get_ai_coach_daily_limit) when subscription_plans was retired.
 *
 * Filtered to is_active 2026-09-05: the list was still showing the retired
 * Prevent / Essential / Complete packs, which no patient can buy, so a cap set
 * against one could never take effect. get_ai_coach_daily_limit() resolves the
 * cap through an ACTIVE service_purchases row, so only a buyable product can
 * ever contribute one. */
export function useServiceProductCoachCaps() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_products")
        .select("id, code, name, price_kobo, currency, ai_coach_daily_limit")
        .eq("is_active", true)
        .order("price_kobo", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useSetProductDailyLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, dailyLimit }: { productId: string; dailyLimit: number | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("service_products")
        .update({ ai_coach_daily_limit: dailyLimit })
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

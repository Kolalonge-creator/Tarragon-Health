import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const QUERY_KEY = ["service-product-ai-coach-caps"];

/** Scoped to just the AI Coach cap field — not a general product editor
 * (service catalogue management itself is a later sprint per CLAUDE.md).
 * Repointed 2026-08-31 at service_products (see
 * public.get_ai_coach_daily_limit) when subscription_plans was retired. */
export function useSubscriptionPlanCaps() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_products")
        .select("id, code, name, price_kobo, currency, ai_coach_daily_limit")
        .order("price_kobo", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useSetPlanDailyLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, dailyLimit }: { planId: string; dailyLimit: number | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("service_products")
        .update({ ai_coach_daily_limit: dailyLimit })
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

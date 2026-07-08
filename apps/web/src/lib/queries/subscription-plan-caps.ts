import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const QUERY_KEY = ["subscription-plan-ai-coach-caps"];

/** Scoped to just the AI Coach cap field — not a general plan editor
 * (subscription plan management itself is a later sprint per CLAUDE.md). */
export function useSubscriptionPlanCaps() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("id, code, name, price_minor, currency, ai_coach_daily_limit")
        .order("price_minor", { ascending: true });
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
        .from("subscription_plans")
        .update({ ai_coach_daily_limit: dailyLimit })
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

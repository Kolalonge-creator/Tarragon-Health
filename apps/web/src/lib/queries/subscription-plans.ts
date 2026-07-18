import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SubscriptionPlan = Tables<"subscription_plans">;

export const ACTIVE_PLANS_QUERY_KEY = ["subscription-plans", "active"];
export const ALL_PLANS_QUERY_KEY = ["subscription-plans", "all"];

/** Every active plan across all currencies, for patient-facing plan
 * selection (onboarding, /patient/subscription) — callers filter by the
 * selected currency tab client-side. subscription_plans is authenticated-
 * readable per its RLS (see 20260705211343_b2b_billing.sql), so this can be
 * called from onboarding before a subscriptions row exists yet. */
export function useActivePatientPlans() {
  return useQuery({
    queryKey: ACTIVE_PLANS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("is_active", true)
        .order("price_minor", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/** Every plan, any currency/active state — admin management view. */
export function useAllSubscriptionPlansAdmin() {
  return useQuery({
    queryKey: ALL_PLANS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("price_minor", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/** Toggle a plan's is_active without touching price/currency/interval — not
 * blocked by price_locked, since visibility isn't a billing-breaking edit. */
export function useSetPlanActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("subscription_plans")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_PLANS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ACTIVE_PLANS_QUERY_KEY });
    },
  });
}

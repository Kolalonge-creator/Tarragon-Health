import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SubscriptionWithPlan = Tables<"subscriptions"> & {
  plan: Tables<"subscription_plans"> | null;
};
export type SubscriptionAddOnWithAddOn = Tables<"subscription_add_ons"> & {
  add_on: Tables<"add_ons"> | null;
};

const CURRENT_SUBSCRIPTION_QUERY_KEY = ["subscriptions", "current"];
const ATTACHED_ADD_ONS_QUERY_KEY = ["subscription-add-ons", "attached"];
const AVAILABLE_ADD_ONS_QUERY_KEY = ["add-ons", "available"];

/** The caller's own most relevant subscription row — prefers an active/
 * trialing one over a cancelled one, most recently started first. RLS
 * already scopes this to subscriber_id = auth.uid() or org staff. */
export function useCurrentSubscription() {
  return useQuery({
    queryKey: CURRENT_SUBSCRIPTION_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("subscriptions")
        .select("*, plan:subscription_plans!subscriptions_plan_id_fkey(*)")
        .eq("subscriber_id", user.id)
        .order("started_at", { ascending: false })
        .limit(20)
        .returns<SubscriptionWithPlan[]>();
      if (error) throw error;
      if (!data || data.length === 0) return null;

      const priority: Record<string, number> = { active: 0, trialing: 1, past_due: 2, cancelled: 3 };
      return [...data].sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9))[0];
    },
  });
}

export function useAttachedAddOns(subscriptionId: string | undefined) {
  return useQuery({
    queryKey: [...ATTACHED_ADD_ONS_QUERY_KEY, subscriptionId],
    enabled: !!subscriptionId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("subscription_add_ons")
        .select("*, add_on:add_ons!subscription_add_ons_add_on_id_fkey(*)")
        .eq("subscription_id", subscriptionId as string)
        .order("started_at", { ascending: true })
        .returns<SubscriptionAddOnWithAddOn[]>();
      if (error) throw error;
      return data;
    },
  });
}

/** Every active add-on in the catalogue — the UI filters by
 * restricted_to_plan_code against the caller's current plan code. */
export function useAvailableAddOns() {
  return useQuery({
    queryKey: AVAILABLE_ADD_ONS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("add_ons")
        .select("*")
        .eq("is_active", true)
        .order("price_minor", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

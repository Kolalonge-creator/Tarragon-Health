import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type AddOn = Tables<"add_ons">;

const ALL_ADD_ONS_QUERY_KEY = ["add-ons", "all"];

/** Every add-on, any active state — admin management view (mirrors
 * useAllSubscriptionPlansAdmin). */
export function useAllAddOnsAdmin() {
  return useQuery({
    queryKey: ALL_ADD_ONS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("add_ons")
        .select("*")
        .order("price_minor", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

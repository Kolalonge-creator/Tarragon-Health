import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
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

export function useSetAddOnActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("add_ons").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_ADD_ONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["add-ons", "available"] });
    },
  });
}

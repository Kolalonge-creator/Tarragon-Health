import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** The signed-in user's profile id (null when signed out). */
export function useCurrentUserId() {
  return useQuery({
    queryKey: ["current-user-id"],
    queryFn: async () => (await createClient().auth.getUser()).data.user?.id ?? null,
    staleTime: Infinity,
  });
}

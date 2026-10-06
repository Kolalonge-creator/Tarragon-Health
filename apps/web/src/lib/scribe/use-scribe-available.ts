import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Whether the AI scribe (AI-017) is switched on. The scribe is hidden, not offered-then-refused, until a Clinical Director
 * has closed its acceptance criteria and enabled it. Fails closed: any error reads as "not available".
 */
export function useScribeAvailable() {
  return useQuery({
    queryKey: ["ai-system-enabled", "AI-017"],
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ai_runtime_config", { p_system_code: "AI-017" });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) return false;
      const config = data as { registered?: boolean; enabled?: boolean };
      return config.registered === true && config.enabled === true;
    },
  });
}

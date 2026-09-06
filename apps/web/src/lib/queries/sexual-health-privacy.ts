import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const key = ["sexual-health-privacy-settings"] as const;

/**
 * Whether the caller has an active privacy PIN on the Sexual & Reproductive
 * Health hub (spec §47.2) and, if so, whether it's currently locked out.
 * pin_hash itself is never selectable (column-level grant, migration
 * 20260829120300) — a row existing at all IS "a PIN is set", since
 * clear_sexual_health_pin deletes the row entirely rather than nulling the
 * hash.
 */
export function useSexualHealthPrivacyStatus() {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sexual_health_privacy_settings")
        .select("failed_attempts, locked_until")
        .maybeSingle();
      if (error) throw error;
      return {
        hasPin: !!data,
        lockedUntil: data?.locked_until ?? null,
      };
    },
  });
}

export function useSetSexualHealthPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pin: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_sexual_health_pin", { p_pin: pin });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useClearSexualHealthPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("clear_sexual_health_pin");
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

/**
 * Returns true/false for a right/wrong guess; throws only for the lockout
 * state (errcode 55006), which the UI renders differently (a countdown, not
 * a retry button) — see verify_sexual_health_pin's own doc comment.
 */
export function useVerifySexualHealthPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pin: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("verify_sexual_health_pin", { p_pin: pin });
      if (error) throw error;
      return data;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

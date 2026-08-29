import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type WearableConnection = Tables<"wearable_connections">;

function key(patientId: string) {
  return ["wearable-connections", patientId];
}

export function useWearableConnections(patientId: string) {
  return useQuery({
    queryKey: key(patientId),
    queryFn: async () => {
      const supabase = createClient();
      // 55.12: 'error' connections are included (not just 'active') so a
      // revoked-token or provider-error connection stays visible to the
      // patient with its last_sync_error, instead of silently disappearing
      // and looking identical to "never connected" — the real gap this
      // closes is documented in wearable-connect-card.tsx.
      const { data, error } = await supabase
        .from("wearable_connections")
        .select("id, provider, status, connected_at, last_synced_at, last_sync_error")
        .eq("patient_id", patientId)
        .in("status", ["active", "error"]);
      if (error) throw error;
      return data as Pick<
        WearableConnection,
        "id" | "provider" | "status" | "connected_at" | "last_synced_at" | "last_sync_error"
      >[];
    },
    enabled: !!patientId,
  });
}

export function useDisconnectWearable(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const supabase = createClient();
      // 55.18 revocation: goes through revoke_wearable_connection() rather
      // than a plain status update, so the stored OAuth tokens are actually
      // nulled (not just the connection marked disconnected) and the action
      // is stamped/audited — see that function's comment for why the plain
      // update this replaced left live credentials behind indefinitely.
      const { error } = await supabase.rpc("revoke_wearable_connection", {
        p_connection_id: connectionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(patientId) });
    },
  });
}

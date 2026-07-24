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
      const { data, error } = await supabase
        .from("wearable_connections")
        .select("id, provider, status, connected_at, last_synced_at")
        .eq("patient_id", patientId)
        .eq("status", "active");
      if (error) throw error;
      return data as Pick<
        WearableConnection,
        "id" | "provider" | "status" | "connected_at" | "last_synced_at"
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
      const { error } = await supabase
        .from("wearable_connections")
        .update({ status: "disconnected" })
        .eq("id", connectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(patientId) });
    },
  });
}

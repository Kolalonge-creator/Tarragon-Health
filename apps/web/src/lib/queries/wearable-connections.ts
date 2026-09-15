import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, TablesUpdate } from "@tarragon/shared";
import type { WearableConsentCategory } from "@/lib/wearables/normalise";

export type WearableConnection = Tables<"wearable_connections">;
export type WearableConnectionStatus = WearableConnection["status"];
type WearableConnectionUpdate = TablesUpdate<"wearable_connections">;
type WearableConsentColumn = "consent_activity" | "consent_heart_rate" | "consent_sleep" | "consent_weight";

function key(patientId: string) {
  return ["wearable-connections", patientId];
}

/** Active and paused connections — a paused one is still "connected" from
 * the patient's point of view (53.13's pause control), just not syncing. A
 * disconnected connection has revoked tokens and isn't shown at all: it's
 * gone, not a state to resume from. */
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
        .select(
          "id, provider, status, connected_at, last_synced_at, last_sync_error, consent_activity, consent_heart_rate, consent_sleep, consent_weight"
        )
        .eq("patient_id", patientId)
        .in("status", ["active", "paused", "error"]);
      if (error) throw error;
      return data as Pick<
        WearableConnection,
        | "id"
        | "provider"
        | "status"
        | "connected_at"
        | "last_synced_at"
        | "last_sync_error"
        | "consent_activity"
        | "consent_heart_rate"
        | "consent_sleep"
        | "consent_weight"
      >[];
    },
    enabled: !!patientId,
  });
}

/** Disconnect, pause and resume are all the same status write, admitted by
 * the same RLS policy + column grant — one mutation covers all three. */
export function useSetWearableConnectionStatus(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      connectionId,
      status,
    }: {
      connectionId: string;
      status: WearableConnectionStatus;
    }) => {
      const supabase = createClient();
      // 55.18 revocation: a disconnect goes through revoke_wearable_connection()
      // rather than a plain status update, so the stored OAuth tokens are
      // actually nulled (not just the connection marked disconnected) and the
      // action is stamped/audited — see that function's comment for why the
      // plain update this replaced left live credentials behind indefinitely.
      // Pause/resume (53.13) stay a plain status update: revoke_wearable_
      // connection() only ever sets 'disconnected' and clears credentials,
      // which would be wrong for a temporary pause the patient expects to
      // reverse without reconnecting.
      const { error } =
        status === "disconnected"
          ? await supabase.rpc("revoke_wearable_connection", { p_connection_id: connectionId })
          : await supabase.from("wearable_connections").update({ status }).eq("id", connectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(patientId) });
    },
  });
}

/** Narrows or widens which categories sync from an existing connection
 * (53.3/53.4) — editable after connecting, not just at connect time. */
export function useUpdateWearableConsent(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      connectionId,
      category,
      granted,
    }: {
      connectionId: string;
      category: WearableConsentCategory;
      granted: boolean;
    }) => {
      const supabase = createClient();
      // A computed property name (`{ [col]: granted }`) widens to a
      // string-indexed object, which Supabase's strictly-typed .update()
      // rejects — an explicit switch keeps each branch a real column-typed
      // update literal instead.
      const update: Pick<WearableConnectionUpdate, WearableConsentColumn> =
        category === "activity"
          ? { consent_activity: granted }
          : category === "heart_rate"
            ? { consent_heart_rate: granted }
            : category === "sleep"
              ? { consent_sleep: granted }
              : { consent_weight: granted };
      const { error } = await supabase.from("wearable_connections").update(update).eq("id", connectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(patientId) });
    },
  });
}

export interface DeleteWearableDataResult {
  vitalsDeleted: number;
  wearableReadingsDeleted: number;
}

/** 53.13's "delete/revoke future access": erases everything this connection
 * synced (vitals_readings + wearable_readings), nulls its stored tokens, and
 * marks it disconnected — see delete_wearable_connection_data() in
 * 20260829120000_wearable_granular_consent_and_patient_control.sql. */
export function useDeleteWearableConnectionData(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string): Promise<DeleteWearableDataResult> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .rpc("delete_wearable_connection_data", { p_connection_id: connectionId })
        .single();
      if (error) throw error;
      return {
        vitalsDeleted: data.vitals_deleted,
        wearableReadingsDeleted: data.wearable_readings_deleted,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(patientId) });
    },
  });
}

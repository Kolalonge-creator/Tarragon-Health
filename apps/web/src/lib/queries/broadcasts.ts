import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Json, Tables } from "@tarragon/shared";

export type NotificationBroadcast = Tables<"notification_broadcasts">;
export type BroadcastAudience = Enums<"broadcast_audience">;
export type NotificationChannel = Enums<"notification_channel">;

export interface BroadcastAudienceFilter {
  state?: string;
  plan_code?: string;
  partner_type?: "pharmacy" | "specialist";
}

const historyKey = ["broadcasts"] as const;

/** Past broadcasts, newest first (admin-only via RLS). */
export function useBroadcastHistory() {
  return useQuery({
    queryKey: historyKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("notification_broadcasts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as NotificationBroadcast[];
    },
  });
}

/**
 * Live preview of how many reachable recipients an audience resolves to — the
 * exact set admin_send_broadcast would enqueue to. Debounce-friendly: the caller
 * gates `enabled` on a chosen audience.
 */
export function useBroadcastAudienceCount(
  audience: BroadcastAudience | null,
  filter: BroadcastAudienceFilter
) {
  return useQuery({
    queryKey: ["broadcast-audience-count", audience, filter],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_broadcast_audience_count", {
        p_audience: audience as BroadcastAudience,
        p_filter: filter as unknown as Json,
      });
      if (error) throw error;
      return data as number;
    },
    enabled: !!audience,
  });
}

export interface SendBroadcastInput {
  title: string;
  body: string;
  audience: BroadcastAudience;
  filter: BroadcastAudienceFilter;
  channels: NotificationChannel[];
}

/**
 * Creates the broadcast row (RLS: admin, created_by = self) then calls
 * admin_send_broadcast to resolve the audience and enqueue notifications. The
 * two-step (persist then send) leaves an auditable record even if the send RPC
 * errors. Returns the recipient count reached.
 */
export function useSendBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendBroadcastInput) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: created, error: insertError } = await supabase
        .from("notification_broadcasts")
        .insert({
          created_by: user.id,
          title: input.title,
          body: input.body,
          audience: input.audience,
          audience_filter: input.filter as unknown as Json,
          channels: input.channels,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const { data: count, error: sendError } = await supabase.rpc("admin_send_broadcast", {
        p_broadcast_id: created.id,
      });
      if (sendError) throw sendError;
      return count as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
}

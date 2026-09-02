import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

/**
 * The in-app notification channel (`notifications.channel = 'in_app'`) has
 * existed in the schema since 20260705211409, with RLS already written for
 * exactly this shape ("recipient sees own, may mark read") — but nothing in
 * the app ever displayed one until the NotificationBell. Intentionally
 * separate from WhatsApp/SMS/email delivery (send-pending-notifications only
 * ever queries channel IN (whatsapp, sms, email)): an in_app row is read
 * directly by the client, never sent externally.
 */
export type InAppNotification = Pick<
  Tables<"notifications">,
  "id" | "status" | "template" | "payload" | "created_at" | "response_options" | "responded_at" | "response_value"
>;

export const inAppNotificationsKey = ["notifications", "in-app"] as const;

const LIMIT = 15;

/** Recent in-app notifications for the signed-in user. Polled rather than
 * realtime-subscribed — a single low-frequency template today, and polling
 * avoids standing up a websocket channel for it. */
export function useInAppNotifications() {
  return useQuery({
    queryKey: inAppNotificationsKey,
    queryFn: async (): Promise<InAppNotification[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      // Explicit recipient_id filter even though RLS already scopes this —
      // notifications_select also grants org staff read of ANY org member's
      // row, which is correct for the org-admin broadcast/outreach surfaces
      // but wrong for a personal notification bell.
      const { data, error } = await supabase
        .from("notifications")
        .select("id, status, template, payload, created_at, response_options, responded_at, response_value")
        .eq("recipient_id", user.id)
        .eq("channel", "in_app")
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });
}

export type CommunicationHistoryRow = Pick<
  Tables<"notifications">,
  | "id"
  | "status"
  | "channel"
  | "priority"
  | "template"
  | "payload"
  | "created_at"
  | "sent_at"
  | "delivered_at"
  | "opened_at"
  | "response_options"
  | "responded_at"
  | "response_value"
>;

const HISTORY_PAGE_SIZE = 25;

/** Communication history (17.8) — every notification ever sent to the
 * signed-in patient, across every channel (not just in_app), with its full
 * delivery/response state. useInfiniteQuery owns page accumulation so the
 * component never needs its own effect-plus-setState to merge pages. */
export function useCommunicationHistory() {
  return useInfiniteQuery({
    queryKey: ["notifications", "history"] as const,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<{ rows: CommunicationHistoryRow[]; hasMore: boolean }> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { rows: [], hasMore: false };

      const from = pageParam * HISTORY_PAGE_SIZE;
      const to = from + HISTORY_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, status, channel, priority, template, payload, created_at, sent_at, delivered_at, opened_at, response_options, responded_at, response_value",
        )
        .eq("recipient_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: data ?? [], hasMore: (data?.length ?? 0) === HISTORY_PAGE_SIZE };
    },
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("notifications")
        .update({ status: "read" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inAppNotificationsKey });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const supabase = createClient();
      const { error } = await supabase.from("notifications").update({ status: "read" }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inAppNotificationsKey });
    },
  });
}

/** Two-way communication (17.9) — captures a quick-reply tap via
 * POST /api/notifications/[id]/respond, which stamps responded_at/
 * response_value server-side and, where a real action exists for the
 * template, performs it (see that route for the appointment_reminder
 * confirm/cancel wiring). Never parses an inbound WhatsApp/SMS reply. */
export function useRespondToNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const res = await fetch(`/api/notifications/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const json = (await res.json()) as { ok: boolean; redirect?: string | null; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not send your response");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inAppNotificationsKey });
    },
  });
}

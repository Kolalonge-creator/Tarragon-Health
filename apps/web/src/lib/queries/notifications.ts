import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  "id" | "status" | "template" | "payload" | "created_at"
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
        .select("id, status, template, payload, created_at")
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

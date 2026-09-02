import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type NotificationTemplate = Tables<"notification_templates">;

export type UnregisteredTemplateUsage = {
  template: string;
  send_count: number;
  last_sent_at: string;
};

/**
 * The full template registry (97.9 notification manager). Admin/
 * notification_templates.manage only (RLS) — the copy itself still renders from
 * TEMPLATE_MAP/notification-bell.tsx (see the registry migration's own header);
 * this is the governance/observability surface over it, not a live-render editor.
 */
export function useNotificationTemplates() {
  return useQuery({
    queryKey: ["notification-templates"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("notification_templates")
        .select("*")
        .order("key", { ascending: true });
      if (error) throw error;
      return data as NotificationTemplate[];
    },
  });
}

export function useSetNotificationTemplateActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, isActive }: { key: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("notification_templates")
        .update({ is_active: isActive })
        .eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-templates"] });
    },
  });
}

/** Clinical Director sign-off for a template flagged requires_clinical_approval. */
export function useApproveNotificationTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("approve_notification_template", { p_key: key });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-templates"] });
    },
  });
}

/** Templates actually enqueued in the last 30 days with no registry entry — the
 * catalogue's own honesty check (it's a soft registry, not a hard FK). */
export function useUnregisteredTemplates() {
  return useQuery({
    queryKey: ["notification-templates", "unregistered"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("notifications_using_unregistered_templates");
      if (error) throw error;
      return (data ?? []) as UnregisteredTemplateUsage[];
    },
  });
}

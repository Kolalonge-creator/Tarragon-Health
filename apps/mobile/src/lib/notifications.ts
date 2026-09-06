import { supabase } from "./supabase";

export interface InAppNotification {
  id: string;
  status: string;
  template: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

const LIMIT = 15;

/** Mirrors useInAppNotifications in apps/web/src/lib/queries/notifications.ts
 * — explicit recipient_id filter, same reasoning: RLS also admits org staff
 * reading a colleague's notifications on the broadcast/outreach surfaces,
 * which is correct there and wrong for a personal bell. */
export async function loadNotifications(userId: string): Promise<InAppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, status, template, payload, created_at")
    .eq("recipient_id", userId)
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    template: row.template,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ status: "read" })
    .eq("recipient_id", userId)
    .eq("channel", "in_app")
    .neq("status", "read");
  if (error) throw error;
}

/** Short line for the notification dropdown — covers the templates most
 * relevant to a patient; anything unmapped falls back to a humanised
 * template name rather than disappearing, same philosophy as
 * notification-bell.tsx's describe(). */
export function describeNotification(n: InAppNotification): string {
  const payload = n.payload;
  switch (n.template) {
    case "health_education_unlock": {
      const title = String(payload.lesson_title ?? "a new lesson");
      return `New lesson ready: "${title}"`;
    }
    case "new_care_message": {
      const role = payload.author_role;
      const who = String(payload.author_display ?? "").trim();
      const from = role === "care_team" ? "your care team" : who || "someone on your care circle";
      return `New message from ${from}`;
    }
    case "medication_refill_due":
    case "medication_refill_reminder": {
      const drug = String(payload.drug_name ?? "a medication");
      return `Refill reminder: ${drug} is due soon`;
    }
    case "escalation_resolved":
      return "A doctor has reviewed something on your record";
    case "family_access_request": {
      const name = String(payload.requester_name ?? "Someone");
      return `${name} sent a request to view your care`;
    }
    default:
      return n.template ? n.template.split("_").join(" ") : "You have a new notification";
  }
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

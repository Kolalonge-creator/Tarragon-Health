import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { reportNotificationOpened } from "@/lib/notification-settings";

/**
 * Registers this device for remote push, closing the one gap left in an
 * otherwise fully-built server-side pipeline: `public.push_subscriptions`
 * already has a `platform`/`expo_push_token` shape for native devices
 * (20260809195100), and supabase/functions/send-pending-notifications
 * already sends real Expo pushes to any row that shows up there — nothing
 * in this app has ever called `getExpoPushTokenAsync()` to create one.
 * Same "best-effort, never blocks the app" discipline as
 * the local reminders in reminder-notifications.ts: a
 * patient who denies push, or a dev build with no EAS project id, still
 * gets a fully working app — just no remote push.
 */
let reportingOpens = false;

/** The id a push carries in its data (send-pending-notifications puts it there), or null. */
export function notificationIdFromData(data: unknown): string | null {
  const id = (data as { notificationId?: unknown } | null | undefined)?.notificationId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Reports a tap on a push (S13b). Listens once per app run, and also handles the tap that launched the app from a
 * closed state. Opens are what separate "delivered" from "seen", so the server can send one email when a push was not.
 */
export function startOpenReporting(): void {
  if (reportingOpens) return;
  reportingOpens = true;
  try {
    Notifications.addNotificationResponseReceivedListener((response) => {
      const id = notificationIdFromData(response.notification.request.content.data);
      if (id) void reportNotificationOpened(id);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const id = notificationIdFromData(response?.notification.request.content.data);
      if (id) void reportNotificationOpened(id);
    });
  } catch {
    // best effort
  }
}

export async function registerPushToken(userId: string, organisationId: string): Promise<void> {
  startOpenReporting();
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null;
    if (!platform) return; // web push goes through the browser subscribe flow instead, not this path

    // Upserts on the token itself, same as a web subscribe re-upserting on
    // `endpoint` — a device re-registering (reinstall, permission re-grant)
    // overwrites its own prior row rather than accumulating duplicates. See
    // push_subscriptions_expo_push_token_key (20260809195100).
    await supabase.from("push_subscriptions").upsert(
      {
        organisation_id: organisationId,
        profile_id: userId,
        platform,
        expo_push_token: data,
        last_seen_at: new Date().toISOString(),
        disabled_at: null,
      },
      { onConflict: "expo_push_token" }
    );
  } catch {
    // Best-effort only — a push-registration failure must never surface to
    // the patient or block anything else in the app from working.
  }
}

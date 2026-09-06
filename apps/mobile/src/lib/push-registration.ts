import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

/**
 * Registers this device for remote push, closing the one gap left in an
 * otherwise fully-built server-side pipeline: `public.push_subscriptions`
 * already has a `platform`/`expo_push_token` shape for native devices
 * (20260809195100), and supabase/functions/send-pending-notifications
 * already sends real Expo pushes to any row that shows up there — nothing
 * in this app has ever called `getExpoPushTokenAsync()` to create one.
 * Same "best-effort, never blocks the app" discipline as
 * ensureDoseReminderPermission/syncDoseReminders in dose-reminders.ts: a
 * patient who denies push, or a dev build with no EAS project id, still
 * gets a fully working app — just no remote push.
 */
export async function registerPushToken(userId: string, organisationId: string): Promise<void> {
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

import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { reportNotificationOpened } from "@/lib/notification-settings";
import { ensureNotificationChannels } from "@/lib/notification-channels";
import { ensurePageChannel } from "@/lib/paging/page-channel";
import { criticalAlertsRequested } from "@/lib/paging/critical-alerts";

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
/** The Expo token this app run registered, so sign-out can switch that one row off (never another phone's). */
let lastRegisteredToken: string | null = null;

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

export async function registerPushToken(userId: string, organisationId: string, options: { clinician?: boolean } = {}): Promise<void> {
  startOpenReporting();
  // Channels first: Android 13+ may not show the permission prompt until one exists, and the server sends safety rows to `urgent`.
  const urgentChannelReady = await ensureNotificationChannels();
  // The on-call alarm channel exists only for a clinician (S19e). The server names it for a page only when this is true.
  const pageChannelReady = options.clinician === true ? await ensurePageChannel() : false;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      // Critical Alerts (iPhone) are asked for only in a build that carries Apple's entitlement (config flag, off until Apple grants it).
      ({ status } = await Notifications.requestPermissionsAsync(
        options.clinician === true && criticalAlertsRequested() ? { ios: { allowAlert: true, allowBadge: true, allowSound: true, allowCriticalAlerts: true } } : undefined
      ));
    }
    if (status !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null;
    if (!platform) return; // web push goes through the browser subscribe flow instead, not this path

    // The token belongs to the PHONE, and a phone has one signed-in account: register_native_push_token moves the row to whoever is
    // signed in now (a plain upsert was refused by the owner-only update policy when a second account used the phone, and a
    // signed-out account's row kept receiving pushes). `userId` and `organisationId` are no longer sent: the database reads them
    // from the session. The page channel is sent only by a clinician's phone (S19e).
    lastRegisteredToken = data;
    // The function is newer than the generated types, hence the cast.
    await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<unknown>)("register_native_push_token", {
      p_token: data,
      p_platform: platform,
      p_urgent_channel_ready: urgentChannelReady,
      p_page_channel_ready: options.clinician === true ? pageChannelReady : null,
    });
  } catch {
    // Best-effort only — a push-registration failure must never surface to
    // the patient or block anything else in the app from working.
  }
}

/** Switches this phone's push row off for the account that is leaving. Best effort and bounded: it must never hold up a sign-out. */
export async function unregisterPushToken(): Promise<void> {
  const token = lastRegisteredToken;
  if (!token) return;
  try {
    await Promise.race([
      Promise.resolve((supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<unknown>)("unregister_native_push_token", { p_token: token })),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // best effort: the next account to register this phone takes the row over
  }
  lastRegisteredToken = null;
}

import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { postPushSubscription, deletePushSubscription } from "./api";
import type { SectionId } from "./sections";

/**
 * Remote push registration + notification-tap deep-linking. The native
 * counterpart to sendExpoPush() in supabase/functions/send-pending-
 * notifications/index.ts — see docs/MOBILE_APP_SPEC.md §4. Local dose
 * reminders (dose-reminders.ts) are unaffected by any of this; this file is
 * only about remote pushes (escalation alerts, care team replies, refill/
 * screening reminders) reaching a closed app.
 *
 * Needs `expo.extra.eas.projectId` in app.json (set once via `eas init`
 * under the project's own Expo account) to mint a token at all — until
 * that's set, registerForPushNotifications() is a no-op rather than a
 * crash, same "best-effort, never block the app" philosophy as
 * syncDoseReminders in dose-reminders.ts. Also note: Expo Go does not
 * support remote push at all from SDK 53 onward (Android) — this only
 * actually delivers anything from an EAS development/production build.
 */

let registeredToken: string | null = null;

export async function registerForPushNotifications(): Promise<void> {
  const platform = Platform.OS;
  if (platform !== "ios" && platform !== "android") return;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return; // EAS project not linked yet -- see app.json TODO.

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    registeredToken = token;
    await postPushSubscription({ platform, expo_push_token: token });
  } catch {
    // Best-effort -- push registration must never block app usage.
  }
}

export async function unregisterPushNotifications(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  try {
    await deletePushSubscription({ expo_push_token: token });
  } catch {
    // Best-effort -- a stale token left server-side just fails silently on
    // next send, the same as an expired web subscription already does.
  }
}

export type DeepLinkDestination =
  | { kind: "section"; section: SectionId }
  | { kind: "webview"; path: string };

/**
 * Maps a push payload's `data.url` (a web-app relative path set by
 * send-pending-notifications' per-template `pushUrl`, e.g.
 * "/patient/medications") to a native section where one exists, or opens
 * the raw path as a WebView otherwise -- the deep-link routing table
 * MOBILE_APP_SPEC.md §10 flags as needed and, until now, didn't exist.
 */
export function resolveDeepLink(url: string): DeepLinkDestination {
  if (url === "/" || url === "/patient") return { kind: "section", section: "overview" };
  if (url === "/patient/vitals" || url.startsWith("/patient/quick-log/")) {
    return { kind: "section", section: "vitals" };
  }
  if (url === "/patient/medications") return { kind: "section", section: "medications" };
  if (url === "/patient/emergency-card") return { kind: "section", section: "emergency" };
  if (url === "/patient/messages") return { kind: "section", section: "messages" };
  if (url === "/patient/health-passport") return { kind: "section", section: "passport" };
  // Everything else (e.g. /patient/supporting, /patient/subscription, or any
  // future template path) has no native screen -- same "WebView everything
  // else" rule the rest of the app follows.
  return { kind: "webview", path: url };
}

/**
 * Wires both ways a tapped push notification reaches the app: foregrounded/
 * backgrounded (addNotificationResponseReceivedListener) and cold-started by
 * the tap itself (getLastNotificationResponseAsync, cleared after reading so
 * it can't re-fire the same destination on a later unrelated relaunch).
 * Returns an unsubscribe function.
 */
export function attachPushTapListener(
  onDeepLink: (destination: DeepLinkDestination) => void,
): () => void {
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      const url = response?.notification.request.content.data?.url;
      if (typeof url === "string") onDeepLink(resolveDeepLink(url));
    })
    .finally(() => {
      void Notifications.clearLastNotificationResponseAsync();
    });

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    if (typeof url === "string") onDeepLink(resolveDeepLink(url));
  });
  return () => subscription.remove();
}

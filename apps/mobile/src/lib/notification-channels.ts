import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Android notification channels (S13 R4). On Android 8 and later the channel, not the message, decides how loud and how
 * visible a notification is, and Expo does not show a push whose `channelId` the phone has never heard of. The server puts
 * every safety message on `urgent` (supabase/functions/_shared/notifications/delivery.ts, URGENT_CHANNEL_ID, kept equal by a
 * test) at high priority.
 *
 * Also found while reading Expo's docs: until some channel exists, Android 13 and later may never show the permission prompt,
 * so these are created BEFORE asking. `default` is what everything else uses.
 *
 * Deliberately not done: a full-screen intent (Google Play restricts it to calling and alarm apps), and bypassing Do Not
 * Disturb (needs a special permission the person must grant themselves; the diagnostics card explains it).
 *
 * Best effort, never throws: a failure here must not stop the app. Needs a real handset to see the effect; nothing here is
 * claimed as device verified.
 */
export const URGENT_CHANNEL_ID = "urgent";
export const DEFAULT_CHANNEL_ID = "default";

export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      name: "Messages",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(URGENT_CHANNEL_ID, {
      name: "Urgent messages",
      description: "Safety messages from your care team that need you to open the app now.",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: "default",
      enableVibrate: true,
      showBadge: true,
    });
  } catch {
    // best effort
  }
}

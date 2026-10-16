import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * The Android alarm channel for on-call pages (S19e). On Android 8 and later the channel, not the message, decides how loud a
 * notification is, and a channel's sound and importance cannot be changed from code after it exists, so this has its own id.
 *
 * What it asks for: maximum importance, the alarm audio stream (rings with the ringer silenced, at the alarm volume), a long
 * vibration, visible on the lock screen, and "override Do Not Disturb". That last one is a request only: Android honours it
 * after the person grants Do Not Disturb access to the app (and may still let them turn it off per channel), which the
 * Device check screen walks them through. The app declares `ACCESS_NOTIFICATION_POLICY` so it appears in that list.
 *
 * Deliberately NOT done: a full-screen intent. Google Play restricts it to calling and alarm apps and it needs native code
 * that cannot be tested here; a notification with this channel on the lock screen is the supported route. (A test in
 * packages/notifications fails if the string for it ever appears in the app config.)
 *
 * The id equals PAGE_CHANNEL_ID in supabase/functions/_shared/notifications/delivery.ts (a test keeps them equal). The server
 * names this channel only for a phone that reported `page_channel_ready`; every other phone keeps the `urgent` channel.
 * Best effort, never throws. Needs a real handset to see the effect; nothing here is claimed as device verified.
 */
export const PAGE_CHANNEL_ID = "on_call_page";

export function pageChannelInput(): Notifications.NotificationChannelInput {
  return {
    name: "On-call pages",
    description: "Urgent pages for the clinician on call. Sounds like an alarm until you open the app.",
    importance: Notifications.AndroidImportance.MAX,
    bypassDnd: true,
    sound: "default",
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
    vibrationPattern: [0, 900, 400, 900, 400, 900],
    enableVibrate: true,
    enableLights: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  };
}

/** True when this phone can ring the page channel (always true on iPhone, which has no channels). */
export async function ensurePageChannel(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const created = await Notifications.setNotificationChannelAsync(PAGE_CHANNEL_ID, pageChannelInput());
    return created !== undefined;
  } catch {
    return false;
  }
}

export interface PageChannelState {
  readonly exists: boolean;
  /** The person (or the phone's maker) may have turned the channel down after it was created. */
  readonly loud: boolean;
  readonly overridesDoNotDisturb: boolean;
}

/** What the phone currently has for the channel, for the Device check screen. Null when it cannot be read (not Android, or an error). */
export async function readPageChannelState(): Promise<PageChannelState | null> {
  if (Platform.OS !== "android") return null;
  try {
    const ch = await Notifications.getNotificationChannelAsync(PAGE_CHANNEL_ID);
    if (!ch) return { exists: false, loud: false, overridesDoNotDisturb: false };
    return { exists: true, loud: ch.importance >= Notifications.AndroidImportance.HIGH, overridesDoNotDisturb: ch.bypassDnd === true };
  } catch {
    return null;
  }
}

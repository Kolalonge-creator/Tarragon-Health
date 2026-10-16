import * as Notifications from "expo-notifications";
import { PAGE_CHANNEL_ID } from "./page-channel";
import { PAGE_URL } from "./page-push";

/**
 * Repeat the alert until the page is acknowledged (S19e). The server sends a page once per clinician and only escalates to other
 * people; it does not ring the same phone again. So when a page push reaches this phone (and the app can run code), a short run
 * of local notifications is scheduled on the same alarm channel, and every one of them is cancelled the moment the screen sees the
 * page acknowledged, closed, expired or gone.
 *
 * Limits, said plainly: this runs only when the app's code runs (foreground, the notification background task, or when the app is
 * opened). A phone that kills background work will ring once (the push itself) and then repeat after the clinician opens the app.
 * Each run is bounded (5 minutes), so a missed cancel cannot ring for ever when nothing else is running; while the app is open and still sees an unacknowledged page, a new run is started when the old one ends. They say only fixed neutral words (INV-07).
 */
export const REPEAT_PREFIX = "page-repeat|";
export const REPEAT_EVERY_SECONDS = 60;
export const REPEAT_COUNT = 5;

export interface AlarmPort {
  schedule(identifier: string, afterSeconds: number): Promise<void>;
  cancel(identifier: string): Promise<void>;
  scheduledIdentifiers(): Promise<string[]>;
}

export function repeatIdentifier(n: number): string {
  return `${REPEAT_PREFIX}${n}`;
}

/**
 * Makes sure a run is scheduled. With `restart` (a new page push just arrived) any earlier run is replaced by a fresh 5 minutes;
 * without it an existing run is left alone, so a screen that polls every few seconds cannot keep sliding the window forward (which
 * would both defeat the 8 minute bound and stop the repeats ever firing). Returns how many are scheduled; never throws.
 */
export async function startPageRepeats(port: AlarmPort, restart = false): Promise<number> {
  try {
    if (!restart && (await repeatsPending(port))) return REPEAT_COUNT;
    await stopPageRepeats(port);
    let scheduled = 0;
    for (let n = 1; n <= REPEAT_COUNT; n += 1) {
      await port.schedule(repeatIdentifier(n), n * REPEAT_EVERY_SECONDS);
      scheduled += 1;
    }
    return scheduled;
  } catch {
    return 0;
  }
}

/** Cancels every pending repeat. Never throws. */
export async function stopPageRepeats(port: AlarmPort): Promise<void> {
  try {
    const ids = await port.scheduledIdentifiers();
    for (const id of ids) if (id.startsWith(REPEAT_PREFIX)) await port.cancel(id);
  } catch {
    // best effort
  }
}

/** True when any repeat is still pending. */
export async function repeatsPending(port: AlarmPort): Promise<boolean> {
  try {
    return (await port.scheduledIdentifiers()).some((id) => id.startsWith(REPEAT_PREFIX));
  } catch {
    return false;
  }
}

/** Fixed neutral words: no case, reading, condition or name can reach the lock screen. */
export const REPEAT_TITLE = "TarragonHealth";
// "may": the page can have been acknowledged on the web, which this phone cannot know while the app is closed.
export const REPEAT_BODY = "A page may still be waiting. Open TarragonHealth to check.";

/** The real port, from expo-notifications. */
export function expoAlarmPort(): AlarmPort {
  return {
    schedule: async (identifier, afterSeconds) => {
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: REPEAT_TITLE,
          body: REPEAT_BODY,
          sound: "default",
          priority: Notifications.AndroidNotificationPriority.MAX,
          interruptionLevel: "timeSensitive",
          data: { url: PAGE_URL, kind: "page_repeat" },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: afterSeconds, channelId: PAGE_CHANNEL_ID },
      });
    },
    cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
    scheduledIdentifiers: async () => (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier),
  };
}

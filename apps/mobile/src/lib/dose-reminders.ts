import * as Notifications from "expo-notifications";
import type { DoseChecklistItem } from "./medications";

/** Show a banner/sound even while the app is foregrounded — otherwise a
 * scheduled local notification only appears once the app is backgrounded. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const REMINDER_PREFIX = "dose-";

function doseIdentifier(item: DoseChecklistItem): string {
  return `${REMINDER_PREFIX}${item.medicationId}-${item.time}`;
}

export async function ensureDoseReminderPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/**
 * Local, device-only dose reminders (MOBILE_APP_SPEC.md §2.3) — the one
 * reminder channel that works with zero signal, no server round trip. A
 * one-shot notification per still-pending dose whose time hasn't passed yet
 * today, re-synced whenever the checklist loads or a dose is marked
 * taken/missed, so a reminder can't fire for something already logged.
 * Never throws — reminders are a nice-to-have, not allowed to block the
 * checklist screen if permission is denied or scheduling fails.
 */
export async function syncDoseReminders(doses: DoseChecklistItem[]): Promise<void> {
  try {
    const granted = await ensureDoseReminderPermission();
    if (!granted) return;

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const alreadyScheduled = new Set(scheduled.map((n) => n.identifier));
    const stillWanted = new Set<string>();

    const now = new Date();
    for (const item of doses) {
      if (item.status !== "pending") continue;

      const [hourStr, minuteStr] = item.time.split(":");
      const hour = Number(hourStr);
      const minute = Number(minuteStr);
      if (Number.isNaN(hour) || Number.isNaN(minute)) continue;

      const fireAt = new Date(now);
      fireAt.setHours(hour, minute, 0, 0);
      if (fireAt.getTime() <= now.getTime()) continue;

      const identifier = doseIdentifier(item);
      stillWanted.add(identifier);
      if (alreadyScheduled.has(identifier)) continue;

      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: "Dose reminder",
          body: `Time for your ${item.drugName} dose (${item.time}).`,
          data: { medicationId: item.medicationId, time: item.time },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
      });
    }

    // Cancel reminders for doses no longer pending (taken/missed since the
    // last sync) or dropped from today's list — never leaves a stale
    // reminder for something the patient already logged.
    for (const notification of scheduled) {
      if (notification.identifier.startsWith(REMINDER_PREFIX) && !stillWanted.has(notification.identifier)) {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }
  } catch {
    // Best-effort — never block the medications screen over a reminder.
  }
}

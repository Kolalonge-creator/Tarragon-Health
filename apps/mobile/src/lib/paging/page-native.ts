import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { getDeviceId, loadActivePages, pingDevice } from "./page-api";
import { expoAlarmPort, stopPageRepeats } from "./page-alarm";
import { ensurePageChannel } from "./page-channel";
import { flushPageReceipts } from "./page-receipts";
import { handlePagePayload, recoverPresentedPages, syncAlarm, type SurfaceDeps } from "./page-surface";

/**
 * The native glue for the on-call page route (S19e): background task, listeners, tray scan, heartbeat and the weekly reminder.
 * Thin on purpose; the decisions live in page-surface.ts. It has never run on a real device. Import this file once, early
 * (App.tsx), because Expo requires the task to be defined in module scope.
 */
export const PAGE_TASK_NAME = "tarragon-on-call-page-task";
export const WEEKLY_REMINDER_ID = "page-weekly-selftest";

const realDeps = (): SurfaceDeps => ({ alarm: expoAlarmPort(), pages: () => loadActivePages(), receipts: undefined });

/** Defined at module scope (as Expo requires) and run by the OS when a notification arrives while the app is backgrounded. */
TaskManager.defineTask(PAGE_TASK_NAME, async ({ data, error }: TaskManager.TaskManagerTaskBody<unknown>) => {
  if (error) return;
  try {
    await handlePagePayload(data, realDeps());
  } catch {
    // never let a background task crash; the receipt is retried when the app is next active
  }
});

/** Monday 09:00 on the phone's clock; fixed neutral words. */
async function scheduleWeeklyReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(WEEKLY_REMINDER_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: WEEKLY_REMINDER_ID,
    content: { title: "TarragonHealth", body: "Weekly check: send yourself a test page.", data: { url: "/clinician/on-call", kind: "page_weekly_selftest" } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 2, hour: 9, minute: 0 },
  });
}

export interface PageSurfaceHandle {
  stop(): void;
}

const PING_EVERY_MS = 60_000;

/**
 * Called once from the clinician home screen. Creates the alarm channel, registers the background notification task, listens for
 * pushes and taps, scans the tray, flushes kept receipts, pings the heartbeat about once a minute while the app is open, and
 * schedules the weekly self-test reminder. Every step is best effort: a failure in one never stops the others, and none can
 * throw to the caller. Returns a handle that removes the listeners and the timer.
 */
export function startPageSurface(isActive: () => boolean): PageSurfaceHandle {
  const deps = realDeps();
  const subs: { remove(): void }[] = [];
  const guard = (fn: () => Promise<unknown>): void => void fn().catch(() => {});

  guard(() => ensurePageChannel());
  guard(() => Notifications.registerTaskAsync(PAGE_TASK_NAME));
  guard(scheduleWeeklyReminder);
  guard(() => flushPageReceipts());
  guard(async () => recoverPresentedPages(await Notifications.getPresentedNotificationsAsync(), deps));
  guard(() => syncAlarm(deps));

  try {
    subs.push(Notifications.addNotificationReceivedListener((n) => guard(() => handlePagePayload(n, deps))));
    subs.push(Notifications.addNotificationResponseReceivedListener((r) => guard(() => handlePagePayload(r, deps))));
    void Notifications.getLastNotificationResponseAsync().then((r) => (r ? handlePagePayload(r, deps) : null)).catch(() => {});
  } catch {
    // an older native build without these: the screen still works and the heartbeat still runs
  }

  const ping = (): void => {
    if (!isActive()) return;
    guard(async () => pingDevice(await getDeviceId()));
    guard(() => flushPageReceipts());
  };
  ping();
  const timer = setInterval(ping, PING_EVERY_MS);

  return {
    stop() {
      clearInterval(timer);
      for (const s of subs) {
        try {
          s.remove();
        } catch {
          // already gone
        }
      }
      // Signed out: the task must not keep running for the next person who signs in on this phone.
      void Notifications.unregisterTaskAsync(PAGE_TASK_NAME).catch(() => {});
      void stopPageRepeats(deps.alarm);
      void Notifications.cancelScheduledNotificationAsync(WEEKLY_REMINDER_ID).catch(() => {});
    },
  };
}

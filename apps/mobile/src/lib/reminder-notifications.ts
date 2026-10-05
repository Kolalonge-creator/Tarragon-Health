import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { planCoverage, planReminderNotifications, withLanguage, type PlannedNotification } from "./reminder-plan";
import { loadReminderPrefs } from "./reminder-prefs";
import { applyPlan, createSerialQueue, type NotificationsPort, type PermissionState, type SyncResult } from "./reminder-sync";
import { loadReminderBehaviour } from "./s07-config";
import { supabase } from "./supabase";
import { getUiLanguage } from "./ui-language";

/**
 * The phone side of reminders (S07): connects the planner (reminder-plan.ts)
 * and the diff (reminder-sync.ts) to expo-notifications. Kept thin on purpose;
 * the rules are in the two pure modules and tested there. This file needs a
 * real device to exercise, so nothing here is claimed as device-verified.
 *
 * The wording is generic and keyed (INV-07): a reminder never names a
 * condition, a reading or a medicine, because a lock screen can be read by
 * anyone. On Android the channel is also marked private so content is hidden on
 * a secure lock screen. Blood pressure only: medicine reminders are S08's
 * (dose-reminders.ts), on their own channel and "dose|" identifiers; this file
 * never touches them (REMINDER_ID_PREFIX scopes every cancel).
 */

/** Show a banner and play a sound even while the app is open, otherwise a scheduled local notification only appears once the app is in the background. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const CHANNEL_ID = "reminders";

function toPermission(status: string): PermissionState {
  return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
}

export async function getNotificationPermission(): Promise<PermissionState> {
  try {
    return toPermission((await Notifications.getPermissionsAsync()).status);
  } catch {
    return "undetermined";
  }
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  try {
    return toPermission((await Notifications.requestPermissionsAsync()).status);
  } catch {
    return "undetermined";
  }
}

function makePort(language: string): NotificationsPort {
  const locale = asLocale(language);
  return {
    getPermission: getNotificationPermission,
    requestPermission: requestNotificationPermission,
    ensureChannel: async () => {
      if (Platform.OS !== "android") return;
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: t("reminders.title", locale),
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    },
    listScheduledIds: async () => (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier),
    cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
    schedule: async (n: PlannedNotification) => {
      await Notifications.scheduleNotificationAsync({
        identifier: n.identifier,
        content: {
          title: t("reminders.notif.title", locale),
          body: t("reminders.notif.bp", locale),
          data: { kind: "bp" },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.notifyAtMs), channelId: CHANNEL_ID },
      });
    },
  };
}

interface BuiltPlan {
  userId: string;
  plan: PlannedNotification[];
  language: string;
}

/** Every sync goes through one queue: two at once can apply an older plan after a newer one. */
const queue = createSerialQueue();

async function buildPlan(nowMs: number): Promise<BuiltPlan | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return null;
  const [prefs, language] = await Promise.all([loadReminderPrefs(userId), getUiLanguage()]);
  return {
    userId,
    language,
    // The language is part of each identifier, so a language change replaces the scheduled text.
    plan: withLanguage(planReminderNotifications({ prefs }, nowMs, loadReminderBehaviour()), language),
  };
}

const NO_USER: SyncResult = { status: "nothing_to_do", permission: "undetermined", scheduled: 0, cancelled: 0, kept: 0, failed: 0 };

/**
 * Brings the phone's scheduled reminders in line with the patient's settings.
 * Safe to call as often as you like (launch, foreground, after an edit on the Reminders
 * screen, the background task) and never throws. Pass `askPermission` only
 * from something the patient just did.
 */
export function syncReminders(options: { askPermission?: boolean } = {}): Promise<SyncResult> {
  return queue
    .run(async () => {
      const built = await buildPlan(Date.now());
      if (!built) return NO_USER;
      return applyPlan(makePort(built.language), built.plan, { askPermission: options.askPermission === true });
    })
    .catch(() => ({ ...NO_USER, status: "failed" as const }));
}

export interface UpcomingReminders {
  items: PlannedNotification[];
  /** The last notification currently scheduled, or null when there are none. */
  coveredUntilMs: number | null;
  /** True when the plan hit its cap, so it stops before the horizon and needs the app opened to top it up. */
  capped: boolean;
}

/** The next few reminders and how far ahead they reach, for the screen. Empty on any failure. */
export async function upcomingReminders(count = 4): Promise<UpcomingReminders> {
  try {
    const built = await queue.run(() => buildPlan(Date.now()));
    if (!built) return { items: [], coveredUntilMs: null, capped: false };
    return { items: built.plan.slice(0, count), ...planCoverage(built.plan, loadReminderBehaviour()) };
  } catch {
    return { items: [], coveredUntilMs: null, capped: false };
  }
}

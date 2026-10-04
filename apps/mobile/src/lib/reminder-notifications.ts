import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { loadTodaysDoses, type DoseChecklistItem } from "./medications";
import {
  REMINDER_ID_PREFIX,
  dosesToPlanInputs,
  planReminderNotifications,
  type PlannedNotification,
} from "./reminder-plan";
import { loadReminderPrefs } from "./reminder-prefs";
import { applyPlan, cancelAllReminders, type NotificationsPort, type PermissionState, type SyncResult } from "./reminder-sync";
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
 * a secure lock screen. Replaces the old dose-reminders.ts, which named the
 * medicine, was English only and covered today only.
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
          body: t(n.kind === "dose" ? "reminders.notif.dose" : "reminders.notif.bp", locale),
          data: { kind: n.kind },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.notifyAtMs), channelId: CHANNEL_ID },
      });
    },
  };
}

interface BuiltPlan {
  userId: string;
  plan: PlannedNotification[];
  /** True when the patient wants medicine reminders but her medicine list could not be read. */
  doseUnknown: boolean;
  language: string;
}

async function buildPlan(nowMs: number, knownDoses?: readonly DoseChecklistItem[]): Promise<BuiltPlan | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return null;
  const [prefs, language] = await Promise.all([loadReminderPrefs(userId), getUiLanguage()]);
  // The medicine list is only read when medicine reminders are on, and not at all when the
  // caller (the Medications screen) already has today's list, which also lets a dose that was
  // just marked taken drop its reminder before the log itself has finished saving.
  const doses = !prefs.doseOn ? null : knownDoses ? ({ ok: true, data: [...knownDoses] } as const) : await loadTodaysDoses(userId);
  const inputs = doses && doses.ok ? dosesToPlanInputs(doses.data) : { doseSchedules: [], handledDoseSlots: new Set<string>() };
  return {
    userId,
    language,
    doseUnknown: prefs.doseOn && !(doses && doses.ok),
    plan: planReminderNotifications({ prefs, ...inputs }, nowMs, loadReminderBehaviour()),
  };
}

const NO_USER: SyncResult = { status: "nothing_to_do", permission: "undetermined", scheduled: 0, cancelled: 0, kept: 0, failed: 0 };

/**
 * Brings the phone's scheduled reminders in line with the patient's settings.
 * Safe to call as often as you like (launch, foreground, after a dose is
 * logged, the background task) and never throws. Pass `askPermission` only
 * from something the patient just did.
 */
export async function syncReminders(options: { askPermission?: boolean; doses?: readonly DoseChecklistItem[] } = {}): Promise<SyncResult> {
  try {
    const built = await buildPlan(Date.now(), options.doses);
    if (!built) return NO_USER;
    return await applyPlan(makePort(built.language), built.plan, {
      askPermission: options.askPermission === true,
      preserve: built.doseUnknown ? ["dose"] : [],
    });
  } catch {
    return { ...NO_USER, status: "failed" };
  }
}

/** The next few reminders, for the screen's "Coming up" list. Empty on any failure. */
export async function upcomingReminders(count = 4): Promise<PlannedNotification[]> {
  try {
    const built = await buildPlan(Date.now());
    return built ? built.plan.slice(0, count) : [];
  } catch {
    return [];
  }
}

/** Cancels this feature's scheduled notifications. Called on sign-out so a shared phone does not keep firing the previous account's reminders. */
export async function cancelAllReminderNotifications(): Promise<void> {
  await cancelAllReminders({
    listScheduledIds: async () => (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier),
    cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  });
}

export { REMINDER_ID_PREFIX };

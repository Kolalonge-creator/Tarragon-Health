import { asLocale, t } from "@tarragon/i18n";
import { getUiLanguage } from "./ui-language";

/**
 * The reminder to measure again (CMO decision 2026-10-05: after a reading at or above the rule set's question line (params.extreme: 200/130 in the approved version 3, 180/120 in the draft version 4) with no emergency symptom,
 * rest and recheck after 2 hours). A local notification scheduled on the phone, so it arrives with no signal and with the
 * app closed; the repeat task on Today (S12) stays as the in-app copy.
 *
 * Wording is generic and keyed (INV-07): it never names a condition or a reading, because a lock screen can be read by
 * anyone. One reminder per person: scheduling again replaces it, a graded result cancels it.
 *
 * Needs a real device to exercise; nothing here is claimed as device-verified. Never throws: a failure to remind must never
 * stand between the patient and the result on screen.
 */
export const RECHECK_REMINDER_PREFIX = "triage-recheck|";
export const recheckReminderId = (subjectId: string): string => `${RECHECK_REMINDER_PREFIX}${subjectId}`;
const CHANNEL_ID = "triage-recheck";

export type RecheckReminderResult = "scheduled" | "no_permission" | "past" | "failed";

/** Loaded on use (inline require) so the on-device grading path never depends on the native module being present. */
function notifications(): typeof import("expo-notifications") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-notifications");
}

export async function scheduleRecheckReminder(subjectId: string, dueAtMs: number, nowMs: number = Date.now()): Promise<RecheckReminderResult> {
  try {
    if (!(dueAtMs > nowMs)) return "past";
    const N = notifications();
    let { status } = await N.getPermissionsAsync();
    // The patient has just saved a reading, so this is something they did; the phone itself never asks twice after a refusal.
    if (status === "undetermined") status = (await N.requestPermissionsAsync()).status;
    if (status !== "granted") return "no_permission";
    const locale = asLocale(await getUiLanguage());
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as typeof import("react-native");
    if (Platform.OS === "android") {
      await N.setNotificationChannelAsync(CHANNEL_ID, {
        name: t("notify.triage.recheck_due.channel", locale),
        importance: N.AndroidImportance.HIGH,
        lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
      });
    }
    await N.scheduleNotificationAsync({
      identifier: recheckReminderId(subjectId),
      content: { title: t("notify.triage.recheck_due.title", locale), body: t("notify.triage.recheck_due.body", locale), data: { kind: "triage_recheck" } },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(dueAtMs), channelId: CHANNEL_ID },
    });
    return "scheduled";
  } catch {
    return "failed";
  }
}

export async function cancelRecheckReminder(subjectId: string): Promise<void> {
  try {
    const N = notifications();
    await N.cancelScheduledNotificationAsync(recheckReminderId(subjectId));
  } catch {
    // nothing scheduled, or the module is unavailable
  }
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import {
  DOSE_NOTIFICATION_PREFIX,
  diffNotifications,
  lagosLocalDate,
  planDoseNotifications,
  reminderIssues,
  slotKey,
  type ReminderIssue,
  type ReminderMedicine,
} from "@tarragon/medicines";
import { loadMedicineRules } from "./medicines-config";
import { readLocalMedications, readLocalRecords } from "./offline-store";
import { listOutbox, type DosePayload } from "./outbox";
import { loadReminderBehaviour } from "./s07-config";
import { scheduleOf } from "./medications";
import { supabase } from "./supabase";
import { getUiLanguage } from "./ui-language";

/**
 * Local, device-only dose reminders: the one reminder channel that works with
 * zero signal and no server round trip. The Today list is the source of truth
 * and a reminder is a convenience, so nothing here is allowed to fail loudly.
 *
 * What the phone holds is a rolling plan (planDoseNotifications): the earliest
 * `maxPending` future doses inside the horizon, under the 64 pending
 * notifications iOS allows, rebuilt on launch, on foreground, after a dose is
 * logged or edited, and by the background task. Doses of different medicines due
 * in the same minute share one notification.
 *
 * Wording is keyed, generic and carries no medicine, dose or condition (INV-07).
 * The slot keys travel in the payload, never in the text.
 */
const DOSE_CHANNEL = "doses";
const SNOOZE_PREFIX = "snooze|";
const PLANNED_AT_KEY = "dose-reminders:planned-at";
const SNOOZE_COUNT_KEY = "dose-reminders:snoozes";

/** Show a banner/sound even while the app is foregrounded, otherwise a scheduled local notification only appears once the app is backgrounded. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function text(key: "medicines.notify.title" | "medicines.notify.body" | "medicines.notify.channel" | "medicines.notify.test_title" | "medicines.notify.test_body") {
  return t(key, asLocale(await getUiLanguage()));
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(DOSE_CHANNEL, {
    name: await text("medicines.notify.channel"),
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Whether the patient has already allowed notifications. Never prompts. */
async function notificationsAllowed(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

/** Asks the OS for notification permission when it has not been decided. Call only from something the patient did. */
export async function ensureDoseReminderPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

interface MedRow {
  id: string;
  is_active?: boolean | null;
  schedule_times: unknown;
  schedule_spec?: unknown;
}

async function loadMedicines(patientId: string): Promise<MedRow[]> {
  try {
    const { data, error } = await supabase
      .from("medications")
      .select("id, is_active, schedule_times, schedule_spec")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .is("superseded_at", null);
    if (!error && data) return data as MedRow[];
  } catch {
    // Offline: fall through to the last copy on this phone.
  }
  return readLocalMedications<MedRow>(patientId);
}

/** Slots already answered, so a dose logged early never gets a reminder. */
async function loadClosedSlots(patientId: string, nowMs: number): Promise<Set<string>> {
  const today = lagosLocalDate(nowMs);
  const closed = new Set<string>();
  const add = (medicationId: string, date: string | null, time: string | null) => {
    if (date && time) closed.add(slotKey(medicationId, { date, time }));
  };
  try {
    const { data, error } = await supabase
      .from("medication_logs_latest_per_slot")
      .select("medication_id, scheduled_for_date, scheduled_time")
      .eq("patient_id", patientId)
      .gte("scheduled_for_date", today)
      .in("status", ["taken", "delayed", "skipped", "not_available"]);
    if (error) throw error;
    for (const r of data ?? []) if (r.medication_id) add(r.medication_id, r.scheduled_for_date, r.scheduled_time);
  } catch {
    const mirrored = await readLocalRecords<{ medication_id: string; scheduled_time: string | null; status: string; scheduled_for_date: string }>("dose", patientId, 200);
    for (const r of mirrored) if (r.status !== "missed") add(r.medication_id, r.scheduled_for_date, r.scheduled_time);
  }
  for (const row of await listOutbox("dose")) {
    const p = row.payload as DosePayload;
    if (row.subjectId === patientId && p.status !== "missed") add(p.medication_id, p.scheduled_for_date, p.scheduled_time);
  }
  return closed;
}

export interface ReplanResult {
  ok: boolean;
  planned: number;
  pending: number;
  /** False when notifications are not allowed. */
  allowed?: boolean;
}

/**
 * Bring the phone's pending dose notifications in line with the schedule. Never
 * throws: a failure leaves the previous plan in place and reports ok:false so the
 * health check can say reminders may be unreliable.
 */
export async function replanDoseReminders(
  patientId: string,
  nowMs: number = Date.now(),
  opts: { prompt?: boolean } = {}
): Promise<ReplanResult> {
  try {
    // Opening the app or returning to it must never raise the OS prompt (S06 fixed the same
    // pattern for Health): only the Medications screen, which the patient chose to open, may ask.
    const granted = opts.prompt ? await ensureDoseReminderPermission() : await notificationsAllowed();
    if (!granted) return { ok: false, planned: 0, pending: 0, allowed: false };
    await ensureChannel();

    const cfg = loadReminderBehaviour();
    const meds = await loadMedicines(patientId);
    const closed = await loadClosedSlots(patientId, nowMs);
    const reminderMeds: ReminderMedicine[] = meds.map((m) => ({ id: m.id, active: m.is_active !== false, spec: scheduleOf(m) }));
    const planned = planDoseNotifications(reminderMeds, closed, nowMs, { maxPending: cfg.maxPending, horizonDays: cfg.horizonDays });

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const diff = diffNotifications(planned, scheduled.map((n) => n.identifier));
    const title = await text("medicines.notify.title");
    const body = await text("medicines.notify.body");

    for (const id of diff.toCancel) await Notifications.cancelScheduledNotificationAsync(id);
    for (const item of diff.toSchedule) {
      await Notifications.scheduleNotificationAsync({
        identifier: item.id,
        content: { title, body, data: { slotKeys: item.slotKeys } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(item.fireAtMs), channelId: DOSE_CHANNEL },
      });
    }
    await AsyncStorage.setItem(PLANNED_AT_KEY, String(nowMs));
    const pending = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) => n.identifier.startsWith(DOSE_NOTIFICATION_PREFIX)).length;
    return { ok: true, planned: planned.length, pending, allowed: true };
  } catch {
    // Best effort: the Today list still shows every dose.
    return { ok: false, planned: 0, pending: 0 };
  }
}

/** Remind again later for one dose, at most `maxSnoozes` times. Nothing is logged: a snooze is only a later reminder. */
export async function snoozeDose(slot: string): Promise<{ ok: true; minutes: number } | { ok: false; reason: "limit" | "failed" }> {
  const cfg = loadReminderBehaviour();
  try {
    const counts = JSON.parse((await AsyncStorage.getItem(SNOOZE_COUNT_KEY)) ?? "{}") as Record<string, number>;
    const used = counts[slot] ?? 0;
    if (used >= cfg.maxSnoozes) return { ok: false, reason: "limit" };
    if (!(await ensureDoseReminderPermission())) return { ok: false, reason: "failed" };
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: `${SNOOZE_PREFIX}${slot}`,
      content: { title: await text("medicines.notify.title"), body: await text("medicines.notify.body"), data: { slotKeys: [slot] } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: cfg.snoozeMinutes * 60,
        channelId: DOSE_CHANNEL,
      },
    });
    counts[slot] = used + 1;
    await AsyncStorage.setItem(SNOOZE_COUNT_KEY, JSON.stringify(counts));
    return { ok: true, minutes: cfg.snoozeMinutes };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** A dose that has been answered needs no more reminders, including a snooze already set. */
export async function cancelSnooze(slot: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(`${SNOOZE_PREFIX}${slot}`);
  } catch {
    // Nothing to cancel.
  }
}

/** Ten seconds from now: lets the patient see for themselves whether reminders reach this phone. */
export async function sendTestReminder(): Promise<boolean> {
  try {
    if (!(await ensureDoseReminderPermission())) return false;
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title: await text("medicines.notify.test_title"), body: await text("medicines.notify.test_body") },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, channelId: DOSE_CHANNEL },
    });
    return true;
  } catch {
    return false;
  }
}

/** Why reminders may be unreliable on this phone, in the order to fix them. Empty means nothing is known to be wrong. */
export async function checkReminderHealth(patientId: string, nowMs: number = Date.now(), known?: ReplanResult): Promise<ReminderIssue[]> {
  try {
    const status = (await notificationsAllowed()) ? "granted" : "denied";
    let plannedCount: number;
    let pending: number;
    if (known && known.ok) {
      // The plan that was just built: no need to read the medicines and logs a second time.
      plannedCount = known.planned;
      pending = known.pending;
    } else {
      const meds = await loadMedicines(patientId);
      const closed = await loadClosedSlots(patientId, nowMs);
      const cfg = loadReminderBehaviour();
      plannedCount = planDoseNotifications(
        meds.map((m) => ({ id: m.id, active: m.is_active !== false, spec: scheduleOf(m) })),
        closed,
        nowMs,
        { maxPending: cfg.maxPending, horizonDays: cfg.horizonDays }
      ).length;
      pending = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) => n.identifier.startsWith(DOSE_NOTIFICATION_PREFIX)).length;
    }
    const plannedAt = Number(await AsyncStorage.getItem(PLANNED_AT_KEY));
    const manufacturer =
      Platform.OS === "android" ? ((Platform.constants as { Manufacturer?: string }).Manufacturer ?? null) : null;
    return reminderIssues({
      notificationsAllowed: status === "granted",
      exactAlarmsAllowed: null,
      plannedCount,
      pendingCount: pending,
      lastPlannedAtMs: Number.isFinite(plannedAt) && plannedAt > 0 ? plannedAt : null,
      nowMs,
      manufacturer,
      stalePlanHours: loadMedicineRules().stalePlanHours,
    });
  } catch {
    return ["nothing_scheduled"];
  }
}

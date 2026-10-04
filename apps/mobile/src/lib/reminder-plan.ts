import { LAGOS_OFFSET_MS, lagosLocalDate } from "./lagos-date";
import { planRollingWindow, type QuietHours, type ReminderSchedule } from "./reminder-schedule";
import type { ReminderBehaviourConfig } from "./s07-config";
import type { DoseChecklistItem } from "./medications";

/**
 * What local notifications should exist, as a pure function (S07 reminders).
 * It takes the patient's reminder settings, her medicine schedule and the dose
 * slots she has already handled today, and returns the exact notifications to
 * schedule. The caller diffs that against what the phone has scheduled, so
 * running it again is always safe (identifiers are stable).
 *
 * Rules:
 * - Reminders are recurring, planned as a rolling window (see planRollingWindow:
 *   at most `maxPending` notifications, inside the horizon, so the phone's own
 *   limit of 64 pending is never exceeded). The caller re-plans on launch, on
 *   foreground and in the background task.
 * - Blood pressure reminders may be held by quiet hours. Medicine reminders never
 *   are: a dose reminder held until morning would arrive after the dose is
 *   already counted as missed.
 * - A dose slot she has already taken or skipped today gets no notification.
 * - Nothing here carries wording. Notification text is generic and keyed (INV-07:
 *   never names a condition, reading, result or medicine), chosen by the caller
 *   from `kind`.
 */
export interface BpReminder {
  id: string;
  /** "HH:MM" in Lagos time. */
  times: readonly string[];
  /** 0 = Sunday ... 6 = Saturday. Null means every day. */
  days: readonly number[] | null;
  active: boolean;
}

export interface ReminderPrefs {
  version: 1;
  bp: readonly BpReminder[];
  /** Remind at the times on her medicine schedule. */
  doseOn: boolean;
  /** Null means no quiet hours (the default). */
  quiet: QuietHours | null;
}

export interface DoseSchedule {
  medicationId: string;
  times: readonly string[];
}

export type ReminderKind = "bp" | "dose";

export interface PlannedNotification {
  identifier: string;
  kind: ReminderKind;
  /** When the phone is asked to notify. */
  notifyAtMs: number;
  /** When the reminder is due (differs from notifyAtMs only when quiet hours held a BP reminder). */
  dueAtMs: number;
}

/** Every identifier this feature schedules starts with this, so it can find and cancel only its own. */
export const REMINDER_ID_PREFIX = "tarragon-reminder:";

export interface PlanInput {
  prefs: ReminderPrefs;
  doseSchedules: readonly DoseSchedule[];
  /** `${medicationId}@HH:MM` for slots already taken or skipped today. */
  handledDoseSlots: ReadonlySet<string>;
}

export function doseSlotKey(medicationId: string, hhmm: string): string {
  return `${medicationId}@${hhmm}`;
}

/**
 * Today's dose checklist (lib/medications.ts) turned into what the planner needs:
 * each medicine's times, and the slots already dealt with today (taken, skipped
 * or recorded missed; only "pending" still wants a reminder).
 */
export function dosesToPlanInputs(items: readonly DoseChecklistItem[]): {
  doseSchedules: DoseSchedule[];
  handledDoseSlots: Set<string>;
} {
  const times = new Map<string, string[]>();
  const handled = new Set<string>();
  for (const i of items) {
    const hhmm = /^\d{2}:\d{2}/.exec(i.time)?.[0] ?? i.time;
    const list = times.get(i.medicationId) ?? [];
    if (!list.includes(hhmm)) list.push(hhmm);
    times.set(i.medicationId, list);
    if (i.status !== "pending") handled.add(doseSlotKey(i.medicationId, hhmm));
  }
  return { doseSchedules: [...times].map(([medicationId, t]) => ({ medicationId, times: t })), handledDoseSlots: handled };
}

function lagosClock(ms: number): string {
  return new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(11, 16);
}

export function planReminderNotifications(
  input: PlanInput,
  nowMs: number,
  cfg: ReminderBehaviourConfig,
): PlannedNotification[] {
  const schedules: ReminderSchedule[] = [
    ...input.prefs.bp.map(
      (r): ReminderSchedule => ({ id: `bp:${r.id}`, times: r.times, days: r.days, active: r.active, respectQuietHours: true }),
    ),
    ...(input.prefs.doseOn
      ? input.doseSchedules.map(
          (m): ReminderSchedule => ({
            id: `dose:${m.medicationId}`,
            times: m.times.map((t) => /^\d{2}:\d{2}/.exec(t)?.[0] ?? t),
            days: null,
            active: true,
            respectQuietHours: false,
          }),
        )
      : []),
  ];

  const today = lagosLocalDate(nowMs);
  const out: PlannedNotification[] = [];
  for (const o of planRollingWindow(schedules, nowMs, cfg, input.prefs.quiet)) {
    const kind: ReminderKind = o.reminderId.startsWith("dose:") ? "dose" : "bp";
    if (kind === "dose" && lagosLocalDate(o.dueAtMs) === today) {
      const medicationId = o.reminderId.slice("dose:".length);
      if (input.handledDoseSlots.has(doseSlotKey(medicationId, lagosClock(o.dueAtMs)))) continue;
    }
    out.push({
      identifier: `${REMINDER_ID_PREFIX}${o.reminderId}:${o.dueAtMs}`,
      kind,
      notifyAtMs: o.notifyAtMs,
      dueAtMs: o.dueAtMs,
    });
  }
  return out;
}

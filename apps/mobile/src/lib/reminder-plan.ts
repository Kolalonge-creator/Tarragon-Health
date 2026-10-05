import { planRollingWindow, type QuietHours, type ReminderSchedule } from "./reminder-schedule";
import type { ReminderBehaviourConfig } from "./s07-config";

/**
 * What blood pressure reminder notifications should exist, as a pure function
 * (S07 reminders). It takes the patient's reminder settings and returns the exact
 * notifications to schedule. The caller diffs that against what the phone has
 * scheduled, so running it again is always safe (identifiers are stable).
 *
 * Medicine reminders are NOT planned here: S08 owns them (dose-reminders.ts and
 * the medicines package), with their own identifiers ("dose|...") and channel.
 * The two share the phone's limit of 64 pending notifications, so this planner is
 * held to `maxPendingBp` and S08's to `maxPending`, which add up to less than 64.
 *
 * Rules:
 * - Reminders are recurring, planned as a rolling window (see planRollingWindow:
 *   at most `maxPendingBp` notifications, inside the horizon). The caller re-plans
 *   on launch, on foreground and in the background task.
 * - Blood pressure reminders may be held by quiet hours. (Medicine reminders never
 *   are, and are not affected by them.)
 * - Nothing here carries wording. Notification text is generic and keyed (INV-07:
 *   never names a condition, reading, result or medicine).
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
  /** Null means no quiet hours (the default). */
  quiet: QuietHours | null;
}

export interface PlannedNotification {
  identifier: string;
  /** When the phone is asked to notify. */
  notifyAtMs: number;
  /** When the reminder is due (differs from notifyAtMs only when quiet hours held it). */
  dueAtMs: number;
}

/** Every identifier this feature schedules starts with this, so it can find and cancel only its own. */
export const REMINDER_ID_PREFIX = "tarragon-reminder:";

export interface PlanInput {
  prefs: ReminderPrefs;
}

/**
 * Puts the language into every identifier. The notification text is fixed when it
 * is scheduled, so without this a language change would keep every old-language
 * notification (the diff compares identifiers only). With it, the old ones are
 * stale and are cancelled and rescheduled.
 */
export function withLanguage(plan: readonly PlannedNotification[], language: string): PlannedNotification[] {
  return plan.map((p) => ({ ...p, identifier: `${p.identifier}@${language}` }));
}

/**
 * How far ahead the plan reaches. When the cap is hit the window ends before the
 * horizon, and the patient should be told, because reminders stop silently once
 * the last planned one has fired if the app is never opened to top them up.
 */
export function planCoverage(
  plan: readonly PlannedNotification[],
  cfg: Pick<ReminderBehaviourConfig, "maxPendingBp">,
): { capped: boolean; coveredUntilMs: number | null } {
  const last = plan[plan.length - 1];
  return { capped: plan.length >= cfg.maxPendingBp, coveredUntilMs: last ? last.notifyAtMs : null };
}

export function planReminderNotifications(
  input: PlanInput,
  nowMs: number,
  cfg: ReminderBehaviourConfig,
): PlannedNotification[] {
  const schedules: ReminderSchedule[] = input.prefs.bp.map(
    (r): ReminderSchedule => ({ id: `bp:${r.id}`, times: r.times, days: r.days, active: r.active, respectQuietHours: true }),
  );
  // This planner's own budget, so it cannot crowd out the medicine reminders (S08) that share the phone's limit.
  const window = planRollingWindow(schedules, nowMs, { ...cfg, maxPending: cfg.maxPendingBp }, input.prefs.quiet);
  return window.map((o) => ({
    identifier: `${REMINDER_ID_PREFIX}${o.reminderId}:${o.dueAtMs}`,
    notifyAtMs: o.notifyAtMs,
    dueAtMs: o.dueAtMs,
  }));
}

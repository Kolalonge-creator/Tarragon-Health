import { addDays, lagosDayStartUtcMs, lagosHour, lagosLocalDate, lagosTimeToUtcMs, weekdayOf, type LocalDate } from "./lagos-date";
import type { ReminderBehaviourConfig } from "./s07-config";

/**
 * Reminder logic for S07, pure: the status machine, the "overdue" rule, the
 * expansion of a schedule into dated occurrences, and the rolling window that
 * decides which occurrences get a local notification.
 *
 * Rules that matter:
 * - "Overdue" and "missed" are derived from the schedule and the clock, never
 *   from whether a notification was delivered. Phone makers (Tecno, Infinix,
 *   Itel) can delay or drop alarms, so delivery is never a safety guarantee.
 * - A snooze is bounded (`maxSnoozes`), so a reminder cannot nag forever.
 * - A missed reminder can still be marked taken or skipped afterwards (logging
 *   after the fact), and is then closed.
 * - iOS keeps at most 64 pending local notifications, so only the earliest
 *   `maxPending` future occurrences inside the horizon are planned, and the
 *   caller re-plans on launch, on foreground and in the background task.
 * - Notification copy never names a condition, reading or medicine (INV-07).
 *   This module carries no copy at all.
 */
export type ReminderStatus = "scheduled" | "snoozed" | "taken" | "skipped" | "missed";
export type ReminderAction = "take" | "skip" | "snooze";

export interface ReminderInstance {
  status: ReminderStatus;
  dueAtMs: number;
  snoozeCount: number;
  snoozedUntilMs: number | null;
  actedAtMs: number | null;
}

export type ActionRefusal = "already_closed" | "snooze_limit";

export type ActionResult =
  | { ok: true; instance: ReminderInstance }
  | { ok: false; reason: ActionRefusal };

const MINUTE = 60 * 1000;

function isClosed(status: ReminderStatus): boolean {
  return status === "taken" || status === "skipped";
}

/** The status to show right now: an open reminder past its missed window is "missed"; a snooze that has run out is "scheduled" again. */
export function deriveReminderStatus(inst: ReminderInstance, nowMs: number, cfg: ReminderBehaviourConfig): ReminderStatus {
  if (isClosed(inst.status)) return inst.status;
  if (nowMs >= inst.dueAtMs + cfg.missedAfterMinutes * MINUTE) return "missed";
  if (inst.status === "snoozed" && inst.snoozedUntilMs !== null && nowMs >= inst.snoozedUntilMs) return "scheduled";
  return inst.status === "missed" ? "scheduled" : inst.status;
}

/** Due and still open. Based only on the clock and the schedule. */
export function isOverdue(inst: ReminderInstance, nowMs: number): boolean {
  return !isClosed(inst.status) && nowMs >= inst.dueAtMs;
}

export function applyReminderAction(
  inst: ReminderInstance,
  action: ReminderAction,
  nowMs: number,
  cfg: ReminderBehaviourConfig,
): ActionResult {
  if (isClosed(inst.status)) return { ok: false, reason: "already_closed" };
  if (action === "snooze") {
    if (inst.snoozeCount >= cfg.maxSnoozes) return { ok: false, reason: "snooze_limit" };
    return {
      ok: true,
      instance: {
        ...inst,
        status: "snoozed",
        snoozeCount: inst.snoozeCount + 1,
        snoozedUntilMs: nowMs + cfg.snoozeMinutes * MINUTE,
      },
    };
  }
  return {
    ok: true,
    instance: { ...inst, status: action === "take" ? "taken" : "skipped", snoozedUntilMs: null, actedAtMs: nowMs },
  };
}

export interface ReminderSchedule {
  id: string;
  /** "HH:MM" in Lagos time. Malformed entries are ignored. */
  times: readonly string[];
  /** 0 = Sunday ... 6 = Saturday. Null means every day. */
  days: readonly number[] | null;
  active: boolean;
}

export interface QuietHours {
  /** Local hour, inclusive. Wraps midnight when startHour > endHour (for example 22 to 7). */
  startHour: number;
  /** Local hour, exclusive. */
  endHour: number;
}

export interface Occurrence {
  reminderId: string;
  dueAtMs: number;
}

/** Expand a schedule into UTC instants within [fromMs, toMs). Sorted, de-duplicated. */
export function expandOccurrences(schedule: ReminderSchedule, fromMs: number, toMs: number): number[] {
  if (!schedule.active || toMs <= fromMs) return [];
  const out = new Set<number>();
  let d: LocalDate = lagosLocalDate(fromMs);
  const last = lagosLocalDate(toMs);
  while (d <= last) {
    if (schedule.days === null || schedule.days.includes(weekdayOf(d))) {
      for (const t of schedule.times) {
        const ms = lagosTimeToUtcMs(d, t);
        if (ms !== null && ms >= fromMs && ms < toMs) out.add(ms);
      }
    }
    d = addDays(d, 1);
  }
  return [...out].sort((a, b) => a - b);
}

function inQuiet(hour: number, q: QuietHours): boolean {
  return q.startHour <= q.endHour ? hour >= q.startHour && hour < q.endHour : hour >= q.startHour || hour < q.endHour;
}

/** Move an instant that falls in quiet hours to the end of the quiet period; others are unchanged. */
export function applyQuietHours(ms: number, quiet: QuietHours | null): number {
  if (!quiet || quiet.startHour === quiet.endHour) return ms;
  if (!inQuiet(lagosHour(ms), quiet)) return ms;
  const date = lagosLocalDate(ms);
  const endToday = lagosDayStartUtcMs(date) + quiet.endHour * 60 * MINUTE;
  if (endToday > ms) return endToday;
  return lagosDayStartUtcMs(addDays(date, 1)) + quiet.endHour * 60 * MINUTE;
}

/**
 * The occurrences that get a local notification: future, inside the horizon,
 * earliest first, capped at `maxPending`. Quiet hours shift a notification
 * later, never earlier, and never past the horizon.
 */
export function planRollingWindow(
  schedules: readonly ReminderSchedule[],
  nowMs: number,
  cfg: ReminderBehaviourConfig,
  quiet: QuietHours | null = null,
): Occurrence[] {
  const horizonMs = nowMs + cfg.horizonDays * 24 * 60 * MINUTE;
  const all: Occurrence[] = [];
  for (const s of schedules) {
    for (const ms of expandOccurrences(s, nowMs, horizonMs)) {
      const shifted = applyQuietHours(ms, quiet);
      if (shifted > nowMs && shifted < horizonMs) all.push({ reminderId: s.id, dueAtMs: shifted });
    }
  }
  all.sort((a, b) => a.dueAtMs - b.dueAtMs || a.reminderId.localeCompare(b.reminderId));
  return all.slice(0, cfg.maxPending);
}

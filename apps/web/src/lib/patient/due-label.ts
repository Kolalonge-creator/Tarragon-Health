/**
 * How a due date reads to a patient: "in 5 days", "today", "due now", "5 days overdue".
 *
 * Screenings and vaccinations are scheduled the moment a risk assessment is saved, with a due date of that same day. Four days
 * later the Action Centre showed a brand-new patient seventeen red "4 days overdue" rows under "High priority", which is both
 * alarming and untrue: nothing was missed, the checks were only just recommended. So a date-driven item carries a grace window
 * (`graceDays`) during which it reads as "due now" and sits with today's items; it becomes "overdue" and high priority only once
 * the window has passed. Items with no grace (a medicine refill, a review the care team set) keep the exact wording.
 *
 * One helper for every surface (the Action Centre, "What's coming up" on Home) so the two can never disagree about a date.
 */

import { lagosLocalDate } from "@tarragon/medicines";

const DAY_MS = 86_400_000;

/** A due date as a Lagos calendar date: a bare `YYYY-MM-DD` is already one; a timestamp is converted. */
function toLagosDate(dateStr: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : lagosLocalDate(Date.parse(dateStr));
}

/**
 * Whole days from today to `dateStr` (negative when the date has passed), on the Africa/Lagos calendar.
 *
 * This used to compare `toDateString()` values, i.e. the clock of whatever machine ran it: UTC on the server, so between
 * midnight and 1am in Lagos "today" was still yesterday; and in a browser west of UTC a bare date parsed as UTC midnight
 * fell on the previous day. Both sides now count Lagos days, the platform's one timezone.
 */
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const today = lagosLocalDate(now.getTime());
  const target = toLagosDate(dateStr);
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** True once the date is past its grace window: the item was genuinely missed. */
export function isOverdue(dateStr: string, graceDays = 0, now: Date = new Date()): boolean {
  return daysUntil(dateStr, now) < -graceDays;
}

/** True while the date is today or inside its grace window: something to do now, not something missed. */
export function isDueNow(dateStr: string, graceDays = 0, now: Date = new Date()): boolean {
  const days = daysUntil(dateStr, now);
  return days <= 0 && days >= -graceDays;
}

export function daysLabel(dateStr: string, graceDays = 0, now: Date = new Date()): string {
  const days = daysUntil(dateStr, now);
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "today";
  if (days >= -graceDays) return "due now";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** The grace window for a screening or vaccination that was scheduled "from today" by a risk assessment. */
export const SCREENING_GRACE_DAYS = 30;

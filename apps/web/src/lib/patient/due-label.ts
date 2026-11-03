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

const DAY_MS = 86_400_000;

/** Whole days from today to `dateStr` (negative when the date has passed). Day boundaries, not timestamps. */
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const today = new Date(now.toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
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

/**
 * The date a group screening day may be requested for. The database already refuses today and anything earlier
 * (`request_screening_day`), so this tells the person before they send rather than after. Dates are Lagos calendar days.
 */
import { lagosToday } from "./learning/expiry";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The earliest date a screening day can be requested for: tomorrow, in Lagos. */
export function earliestScreeningDayDate(now: Date = new Date()): string {
  return lagosToday(new Date(now.getTime() + DAY_MS));
}

/** Null when the date is fine, otherwise the sentence to show. */
export function screeningDayDateProblem(value: string, now: Date = new Date()): string | null {
  const text = value.trim();
  if (!text) return "When is it happening?";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "Write the date as year-month-day, for example 2026-12-05.";
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return "That date does not exist. Check the day and month.";
  if (text < earliestScreeningDayDate(now)) return "Choose a date after today.";
  return null;
}

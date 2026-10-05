/**
 * Local-day arithmetic for Africa/Lagos, the platform timezone (CLAUDE.md:
 * "Timezone always Africa/Lagos"). Lagos is a fixed UTC+1 offset with no DST, so
 * plain offset math is exact and needs no timezone database (same approach as
 * greeting.ts). Everything is derived from a UTC millisecond instant and never
 * from the phone's own timezone, so a phone set to New York or London buckets a
 * reading into the same Lagos day.
 *
 * A "local date" is a YYYY-MM-DD string. Streaks, the Today list and the trend
 * windows all bucket on it.
 */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type LocalDate = string;

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLocalDate(value: string): boolean {
  if (!LOCAL_DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function assertLocalDate(value: string): void {
  if (!isValidLocalDate(value)) throw new RangeError(`Not a local date (YYYY-MM-DD): ${value}`);
}

/** The Lagos calendar date of a UTC instant. */
export function lagosLocalDate(utcMs: number): LocalDate {
  return new Date(utcMs + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** Lagos hour of day, 0 to 23. */
export function lagosHour(utcMs: number): number {
  return new Date(utcMs + LAGOS_OFFSET_MS).getUTCHours();
}

/** Whole days since 1970-01-01 for a local date (an integer, so subtraction is exact). */
export function dayIndex(date: LocalDate): number {
  assertLocalDate(date);
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  assertLocalDate(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** b minus a, in whole days (positive when b is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return dayIndex(b) - dayIndex(a);
}

/** UTC instant of 00:00 Lagos time on a local date. */
export function lagosDayStartUtcMs(date: LocalDate): number {
  assertLocalDate(date);
  return Date.parse(`${date}T00:00:00Z`) - LAGOS_OFFSET_MS;
}

/** UTC instant of an "HH:MM" Lagos wall-clock time on a local date, or null if the time is malformed. */
export function lagosTimeToUtcMs(date: LocalDate, time: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return lagosDayStartUtcMs(date) + (h * 60 + min) * 60 * 1000;
}

/** 0 = Sunday ... 6 = Saturday, for a local date. */
export function weekdayOf(date: LocalDate): number {
  assertLocalDate(date);
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The Monday on or before a local date (weeks run Monday to Sunday). */
export function weekStart(date: LocalDate): LocalDate {
  const dow = weekdayOf(date);
  return addDays(date, -((dow + 6) % 7));
}

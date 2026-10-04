/**
 * Africa/Lagos calendar arithmetic. Lagos is a fixed UTC+1 with no daylight
 * saving, so plain offset maths is exact and needs no timezone database. A
 * "local date" is a YYYY-MM-DD string; everything derives from a UTC instant,
 * never from the phone's own timezone, so a phone set to London or New York
 * buckets a dose into the same Lagos day (and a clock change cannot move it).
 */
export type LocalDate = string;

export const LAGOS_OFFSET_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !LOCAL_DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

function assertDate(value: string): void {
  if (!isValidLocalDate(value)) throw new RangeError(`Not a local date (YYYY-MM-DD): ${value}`);
}

export function lagosLocalDate(utcMs: number): LocalDate {
  return new Date(utcMs + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  assertDate(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** b minus a, in whole days (positive when b is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  assertDate(a);
  assertDate(b);
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  assertDate(date);
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** UTC instant of an "HH:MM" Lagos wall-clock time on a local date. */
export function lagosTimeToUtcMs(date: LocalDate, time: string): number {
  assertDate(date);
  const m = TIME_RE.exec(time);
  if (!m) throw new RangeError(`Not a time (HH:MM): ${time}`);
  return Date.parse(`${date}T00:00:00Z`) - LAGOS_OFFSET_MS + (Number(m[1]) * 60 + Number(m[2])) * MINUTE_MS;
}

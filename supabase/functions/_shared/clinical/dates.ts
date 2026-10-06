const MS_PER_DAY = 86_400_000;
/** Africa/Lagos is UTC+1 all year with no daylight saving. */
const LAGOS_OFFSET_MS = 3_600_000;

/** Milliseconds for an ISO timestamp, or NaN when it is not a real date. */
export const toMs = (iso: string): number => Date.parse(iso);

export const isValidTimestamp = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** The Lagos calendar date (YYYY-MM-DD) of an instant. */
export const lagosDateKey = (ms: number): string => new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10);

const dayNumber = (dateKey: string): number => Date.parse(`${dateKey}T00:00:00Z`) / MS_PER_DAY;

/** Whole Lagos calendar days from `fromMs` to `toMs` (never negative). */
export const lagosDaysBetween = (fromMs: number, toMsValue: number): number =>
  Math.max(0, dayNumber(lagosDateKey(toMsValue)) - dayNumber(lagosDateKey(fromMs)));

/** ISO week label, for example 2026-W41, of a Lagos calendar date. */
export function isoWeekKey(dateKey: string): string {
  const day = dayNumber(dateKey);
  const weekdayMondayZero = (new Date(day * MS_PER_DAY).getUTCDay() + 6) % 7;
  const thursday = day + (3 - weekdayMondayZero);
  const year = new Date(thursday * MS_PER_DAY).getUTCFullYear();
  const week = Math.floor((thursday - dayNumber(`${year}-01-01`)) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export const daysToMs = (d: number): number => d * MS_PER_DAY;

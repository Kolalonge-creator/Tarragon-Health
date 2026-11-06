/**
 * One set of time ranges for every patient trend chart (patient dashboard 2.0,
 * gap P17; spec section 10.2). The vitals chart and the biomarker (lab result)
 * chart used to offer different choices (7/30/90 days against 3 months / 6
 * months / 1 year / all). Both now offer these six, with the same words.
 *
 * Display only: a range narrows which stored points are shown. It never adds,
 * moves or interpolates a point.
 */
export const TREND_RANGES = ["7d", "30d", "90d", "6m", "12m", "all"] as const;

export type TrendRange = (typeof TREND_RANGES)[number];

export const TREND_RANGE_LABEL: Record<TrendRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "6m": "6 months",
  "12m": "12 months",
  all: "All",
};

/**
 * The most points one chart reads at once. A wide range (12 months, All) can
 * hold years of home readings; the chart reads the newest this many and says so
 * when it hits the cap, rather than reading without a bound.
 */
export const TREND_MAX_POINTS = 2000;

/**
 * A capped read asks for TREND_MAX_POINTS + 1 rows; getting more than the cap
 * back means older readings in the range were not read. Exactly the cap is
 * everything, and must not be reported as cut short.
 */
export function trendHitCap(rowCount: number): boolean {
  return rowCount > TREND_MAX_POINTS;
}

/** Range values the biomarker page used in its links before the ranges were unified, mapped so an old link still opens the nearest range. */
const LEGACY_RANGE: Record<string, TrendRange> = { "3m": "90d", "1y": "12m" };

/** A range from a URL or stored value; anything unknown falls back. */
export function parseTrendRange(value: string | null | undefined, fallback: TrendRange): TrendRange {
  if (!value) return fallback;
  return TREND_RANGES.find((r) => r === value) ?? LEGACY_RANGE[value] ?? fallback;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** Whole calendar months back, clamped to the month's last day so Aug 31 minus 6 months is Feb 28/29, not Mar 3. Lagos has no DST, so a fixed UTC+1 shift is exact. */
function monthsBack(now: Date, months: number): Date {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const y = lagos.getUTCFullYear();
  const m = lagos.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(lagos.getUTCDate(), lastDay);
  return new Date(Date.UTC(y, m, day, lagos.getUTCHours(), lagos.getUTCMinutes()) - LAGOS_OFFSET_MS);
}

/**
 * The earliest instant inside the range, or null for "all". Day ranges are
 * exact multiples of 24 hours back from now; month ranges are calendar months
 * in Lagos time.
 */
export function trendRangeStart(range: TrendRange, now: Date = new Date()): Date | null {
  switch (range) {
    case "7d":
      return new Date(now.getTime() - 7 * DAY_MS);
    case "30d":
      return new Date(now.getTime() - 30 * DAY_MS);
    case "90d":
      return new Date(now.getTime() - 90 * DAY_MS);
    case "6m":
      return monthsBack(now, 6);
    case "12m":
      return monthsBack(now, 12);
    case "all":
      return null;
  }
}

/** Keeps the points taken inside the range. Never changes a point. */
export function pointsInTrendRange<T>(points: readonly T[], takenAt: (p: T) => string, range: TrendRange, now: Date = new Date()): T[] {
  const start = trendRangeStart(range, now);
  if (!start) return [...points];
  const cutoff = start.getTime();
  return points.filter((p) => new Date(takenAt(p)).getTime() >= cutoff);
}

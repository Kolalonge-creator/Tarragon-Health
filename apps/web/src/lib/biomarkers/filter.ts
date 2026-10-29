import type { TrendPoint } from "@tarragon/shared";

export const TREND_RANGES = ["3m", "6m", "1y", "all"] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

const RANGE_MONTHS: Record<Exclude<TrendRange, "all">, number> = { "3m": 3, "6m": 6, "1y": 12 };

export function parseTrendRange(value: string | undefined): TrendRange {
  return TREND_RANGES.find((r) => r === value) ?? "all";
}

/** Sources actually present in the series, in first-seen order, so the filter never offers an empty choice. */
export function sourcesIn(points: TrendPoint[]): string[] {
  return [...new Set(points.flatMap((p) => (p.alsoFrom ? [p.source, p.alsoFrom] : [p.source])))];
}

/** Whole calendar months back, clamped to the month's last day so Aug 31 minus 6 months is Feb 28/29, not Mar 3. Lagos has no DST, so a fixed UTC+1 shift is exact. */
function monthsBack(now: Date, months: number): Date {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  const y = lagos.getUTCFullYear();
  const m = lagos.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(lagos.getUTCDate(), lastDay);
  return new Date(Date.UTC(y, m, day, lagos.getUTCHours(), lagos.getUTCMinutes()) - 60 * 60 * 1000);
}

/**
 * Narrows a series by date window and reporting source. Display only: it never
 * changes a value, a range or a flag. An unknown source filters nothing, so a
 * stale link cannot hide results.
 */
export function filterTrendPoints(points: TrendPoint[], range: TrendRange, source: string | undefined, now: Date = new Date()): TrendPoint[] {
  let out = points;
  if (range !== "all") {
    const cutoff = monthsBack(now, RANGE_MONTHS[range]);
    out = out.filter((p) => new Date(p.takenAt).getTime() >= cutoff.getTime());
  }
  if (source && sourcesIn(points).includes(source)) out = out.filter((p) => p.source === source || p.alsoFrom === source);
  return out;
}

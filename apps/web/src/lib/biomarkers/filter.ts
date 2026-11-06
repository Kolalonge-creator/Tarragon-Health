import { parseTrendRange as parseSharedTrendRange, pointsInTrendRange, type TrendPoint, type TrendRange } from "@tarragon/shared";

// The one range set shared with the vitals chart (P17): 7d, 30d, 90d, 6m, 12m, all.
export { TREND_RANGES, TREND_RANGE_LABEL, type TrendRange } from "@tarragon/shared";

/** The biomarker page opens on every result; an old link (3m, 1y) opens the nearest current range. */
export function parseTrendRange(value: string | undefined): TrendRange {
  return parseSharedTrendRange(value, "all");
}

/** Sources actually present in the series, in first-seen order, so the filter never offers an empty choice. */
export function sourcesIn(points: TrendPoint[]): string[] {
  return [...new Set(points.flatMap((p) => (p.alsoFrom ? [p.source, p.alsoFrom] : [p.source])))];
}

/**
 * Narrows a series by date window and reporting source. Display only: it never
 * changes a value, a range or a flag. An unknown source filters nothing, so a
 * stale link cannot hide results.
 */
export function filterTrendPoints(points: TrendPoint[], range: TrendRange, source: string | undefined, now: Date = new Date()): TrendPoint[] {
  let out = pointsInTrendRange(points, (p) => p.takenAt, range, now);
  if (source && sourcesIn(points).includes(source)) out = out.filter((p) => p.source === source || p.alsoFrom === source);
  return out;
}

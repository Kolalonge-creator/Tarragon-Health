/**
 * Pure model for the glucose and weight trend charts on the phone (S47b, v5 4.6): where each reading and the shaded target band sit in a box, and the
 * words that describe the chart. The band is the standard one from `trend-bands` in @tarragon/shared (the same logic the web charts use) or a care
 * team's own range. The chart never calls a reading good or bad, and a screen reader gets the words (the summary and the caption), not the drawing.
 */
export interface SeriesReading {
  atMs: number;
  value: number;
}

export interface SeriesBand {
  low: number;
  high: number;
  origin: "standard" | "care_team";
}

export interface SeriesPoint {
  /** 0 (left, oldest) to 1 (right, now). */
  x: number;
  /** 0 (bottom) to 1 (top). */
  y: number;
  value: number;
  atMs: number;
}

export interface SeriesModel {
  points: SeriesPoint[];
  /** The band as a bottom and top fraction of the box, or null when no band applies. */
  band: { bottom: number; top: number } | null;
  yMin: number;
  yMax: number;
  count: number;
  min: number;
  max: number;
  latest: number;
}

const DAY_MS = 86_400_000;

/** Readings in the window, oldest first. Unreadable times and values are dropped, never guessed. */
export function windowSeries(readings: readonly SeriesReading[], windowDays: number, nowMs: number): SeriesReading[] {
  const from = nowMs - windowDays * DAY_MS;
  return readings
    .filter((r) => Number.isFinite(r.atMs) && Number.isFinite(r.value) && r.atMs >= from && r.atMs <= nowMs)
    .sort((a, b) => a.atMs - b.atMs);
}

/** Null when there is nothing to draw. The vertical range always includes the band, so the shading is never clipped. */
export function buildSeriesModel(readings: readonly SeriesReading[], windowDays: number, nowMs: number, band: SeriesBand | null): SeriesModel | null {
  const rows = windowSeries(readings, windowDays, nowMs);
  if (rows.length === 0) return null;
  const values = rows.map((r) => r.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  let lo = band ? Math.min(min, band.low) : min;
  let hi = band ? Math.max(max, band.high) : max;
  const pad = (hi - lo || Math.max(Math.abs(hi), 1)) * 0.1;
  lo -= pad;
  hi += pad;
  const span = hi - lo;
  const from = nowMs - windowDays * DAY_MS;
  return {
    points: rows.map((r) => ({ x: (r.atMs - from) / (windowDays * DAY_MS), y: (r.value - lo) / span, value: r.value, atMs: r.atMs })),
    band: band ? { bottom: (band.low - lo) / span, top: (band.high - lo) / span } : null,
    yMin: lo,
    yMax: hi,
    count: rows.length,
    min,
    max,
    latest: (rows[rows.length - 1] as SeriesReading).value,
  };
}

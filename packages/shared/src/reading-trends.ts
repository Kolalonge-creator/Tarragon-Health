import {
  HOME_PIN_NEVER_FROM_WEARABLE,
  HOME_PIN_VITAL_COLUMN,
  HOME_PIN_VITAL_TYPE,
  isHomeValuePin,
  type HomePinKey,
} from "./home-pins";

/**
 * Big numbers and trend lines (2026-11-06, founder, chosen in a prompt). The pure half, shared by the web dashboard and the
 * phone app so both draw the same line, use the same words and apply the same reading rules from one copy.
 */

const DAY = 86_400_000;

/** One point on a trend line. */
export interface SparkPoint {
  /** Time, ms. */
  t: number;
  v: number;
}

/**
 * An SVG path for a single-series trend line in a `width` x `height` box, and where its latest point sits. Fewer than two points
 * draw nothing. A flat series sits in the middle rather than on the floor.
 */
export function sparkPath(points: readonly SparkPoint[], width: number, height: number, pad = 3): { d: string; last: { x: number; y: number } } | null {
  if (points.length < 2) return null;
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  const x = (t: number) => (t1 === t0 ? width / 2 : pad + ((t - t0) / (t1 - t0)) * (width - 2 * pad));
  const y = (v: number) => (v1 === v0 ? height / 2 : height - pad - ((v - v0) / (v1 - v0)) * (height - 2 * pad));
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const d = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const lastPoint = sorted[sorted.length - 1]!;
  return { d, last: { x: x(lastPoint.t), y: y(lastPoint.v) } };
}

/**
 * A plain word for which way a reading has moved this month. It describes the shape only: "Higher" is not "worse" and the tile
 * never colours it, because whether higher is good depends on the reading and the person, which is the care team's call. The last
 * 7 days are compared with the 23 before; each side needs at least two readings, otherwise there is no word at all rather than a
 * guess. Within 3 percent reads as steady.
 */
export function trendWord(points: readonly SparkPoint[], nowMs: number): string | null {
  const recent = points.filter((p) => p.t > nowMs - 7 * DAY);
  const earlier = points.filter((p) => p.t <= nowMs - 7 * DAY && p.t > nowMs - 30 * DAY);
  if (recent.length < 2 || earlier.length < 2) return null;
  const mean = (xs: readonly SparkPoint[]) => xs.reduce((s, p) => s + p.v, 0) / xs.length;
  const a = mean(recent);
  const b = mean(earlier);
  if (b === 0) return null;
  const change = (a - b) / Math.abs(b);
  if (Math.abs(change) < 0.03) return "Steady this month";
  return change > 0 ? "Higher than earlier this month" : "Lower than earlier this month";
}

/** "Today, 08:10", "Yesterday", "3 days ago" or "12 Oct", in Lagos time. */
export function whenLabel(takenAtMs: number, nowMs: number): string {
  const lagosDay = (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(lagosDay(nowMs)) - Date.parse(lagosDay(takenAtMs))) / DAY);
  if (days <= 0) {
    const hm = new Date(takenAtMs).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });
    return `Today, ${hm}`;
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(takenAtMs).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

/** "Today, 08:10 · Steady this month", or whichever half exists, or null with no reading. */
export function readingDetail(series: { latestAt: number | null; points: readonly SparkPoint[] }, nowMs: number): string | null {
  if (series.latestAt === null) return null;
  return [whenLabel(series.latestAt, nowMs), trendWord(series.points, nowMs)].filter(Boolean).join(" · ");
}

/** The readings a big-number tile can chart. */
export type SeriesPinKey = "bp" | "glucose" | keyof typeof HOME_PIN_VITAL_COLUMN;

/** The chart window, in days. */
export const PIN_SERIES_WINDOW_DAYS = 30;
/** Enough rows to cover a month of several readings a day without reading the whole history. */
export const PIN_SERIES_MAX_ROWS = 120;

export function isSeriesPin(key: HomePinKey): key is SeriesPinKey {
  return key === "bp" || key === "glucose" || isHomeValuePin(key);
}

/** The vitals_readings column a series reads: for blood pressure, the top (systolic) number. */
export function pinSeriesColumn(key: SeriesPinKey): string {
  if (key === "bp") return "systolic";
  if (key === "glucose") return "glucose_mmol_l";
  return HOME_PIN_VITAL_COLUMN[key];
}

export function pinSeriesVitalType(key: SeriesPinKey): (typeof HOME_PIN_VITAL_TYPE)[SeriesPinKey] {
  return HOME_PIN_VITAL_TYPE[key];
}

/** Blood pressure joins the never-from-a-wearable rule, as on the summary stats: a cuffless estimate is not a reading. */
export function pinSeriesExcludesWearable(key: SeriesPinKey): boolean {
  return key === "bp" || HOME_PIN_NEVER_FROM_WEARABLE.includes(key as HomePinKey);
}

export interface PinSeries {
  /** When the most recent reading was taken (it may be older than the chart window), or null with no reading. */
  latestAt: number | null;
  /** The most recent reading's stored value (kg, mmol/L, bpm...), never converted; for blood pressure, the top number. */
  latestValue: number | null;
  /** Readings in the last 30 days, oldest first. */
  points: SparkPoint[];
}

/**
 * Turns rows read newest first (`taken_at` plus the series column) into a series: the latest reading is kept even when it is older
 * than the chart window, and only the last 30 days are charted. Rows without a usable time or number are dropped. The read itself
 * must already have left out corrected readings (and wearable estimates where `pinSeriesExcludesWearable` says so).
 */
export function parsePinSeries(rows: readonly Record<string, unknown>[], column: string, nowMs: number): PinSeries {
  const since = nowMs - PIN_SERIES_WINDOW_DAYS * DAY;
  const parsed = rows
    .map((row) => ({ t: Date.parse(String(row.taken_at)), v: row[column] === null || row[column] === undefined ? NaN : Number(row[column]) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  return {
    latestAt: parsed[0]?.t ?? null,
    latestValue: parsed[0]?.v ?? null,
    points: parsed.filter((p) => p.t >= since).reverse(),
  };
}

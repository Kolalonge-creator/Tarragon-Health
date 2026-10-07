import type { BpLevel, BpThresholds } from "./bp-classification";
import type { BpReading } from "./vitals";

/**
 * Pure geometry and statistics for the blood pressure trend chart (design Phase
 * 1). No drawing and no React here, so every rule is unit tested: which readings
 * fall in a window, how values map to pixels, where the reference lines sit, and
 * which point a finger is nearest to.
 *
 * Nothing in this file interprets a reading clinically. The two dashed reference
 * lines are the app's own "above target" levels (the amber thresholds in
 * bp-classification.ts, kept in step with the server through threshold-sync.ts),
 * and the summary is descriptive only (count, range, average, latest). It never
 * says a trend is improving or worsening: that is a clinician's judgement.
 */
export type TrendWindowDays = 7 | 30;

export interface TrendPoint {
  reading: BpReading;
  x: number;
  ySys: number;
  yDia: number;
}

export interface ChartPadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TrendModel {
  points: TrendPoint[];
  yTicks: { y: number; value: number }[];
  /** Pixel rows of the two "above target" reference lines. */
  refSysY: number;
  refDiaY: number;
  domain: { min: number; max: number };
  plot: { left: number; right: number; top: number; bottom: number };
  startMs: number;
  endMs: number;
}

const DAY_MS = 86_400_000;

/** Readings inside the last `days` days, oldest first. */
export function windowReadings(readings: BpReading[], days: TrendWindowDays, nowMs: number): BpReading[] {
  const start = nowMs - days * DAY_MS;
  return readings
    .filter((r) => {
      const t = new Date(r.takenAt).getTime();
      return Number.isFinite(t) && t >= start && t <= nowMs + 5 * 60_000;
    })
    .sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
}

/** Rounds a value range outward to multiples of 20 so the axis labels are tidy. */
export function niceDomain(lowest: number, highest: number, ceilingRef: number, floorRef: number): { min: number; max: number } {
  const lo = Math.min(lowest, floorRef) - 5;
  const hi = Math.max(highest, ceilingRef) + 5;
  const min = Math.max(20, Math.floor(lo / 20) * 20);
  const max = Math.min(280, Math.ceil(hi / 20) * 20);
  return { min, max: Math.max(max, min + 40) };
}

export function buildTrendModel(
  windowed: BpReading[],
  windowDays: TrendWindowDays,
  nowMs: number,
  width: number,
  height: number,
  thresholds: Pick<BpThresholds, "amber">,
  padding: ChartPadding = { left: 36, right: 12, top: 12, bottom: 24 }
): TrendModel {
  const plot = { left: padding.left, right: width - padding.right, top: padding.top, bottom: height - padding.bottom };
  const startMs = nowMs - windowDays * DAY_MS;
  const endMs = nowMs;

  const sysValues = windowed.map((r) => r.systolic);
  const diaValues = windowed.map((r) => r.diastolic);
  const domain = niceDomain(
    diaValues.length ? Math.min(...diaValues) : thresholds.amber.diastolic,
    sysValues.length ? Math.max(...sysValues) : thresholds.amber.systolic,
    thresholds.amber.systolic,
    thresholds.amber.diastolic
  );

  const spanY = plot.bottom - plot.top;
  const yFor = (value: number) => plot.bottom - ((value - domain.min) / (domain.max - domain.min)) * spanY;
  const spanX = plot.right - plot.left;
  const xFor = (ms: number) => plot.left + Math.min(1, Math.max(0, (ms - startMs) / (endMs - startMs))) * spanX;

  const points: TrendPoint[] = windowed.map((reading) => ({
    reading,
    x: xFor(new Date(reading.takenAt).getTime()),
    ySys: yFor(reading.systolic),
    yDia: yFor(reading.diastolic),
  }));

  const yTicks: { y: number; value: number }[] = [];
  for (let v = domain.min; v <= domain.max; v += 20) yTicks.push({ y: yFor(v), value: v });

  return {
    points,
    yTicks,
    refSysY: yFor(thresholds.amber.systolic),
    refDiaY: yFor(thresholds.amber.diastolic),
    domain,
    plot,
    startMs,
    endMs,
  };
}

/** Index of the point whose x is closest to `x`, or -1 with no points. */
export function nearestPointIndex(points: { x: number }[], x: number): number {
  if (points.length === 0) return -1;
  let best = 0;
  let bestDistance = Math.abs(points[0].x - x);
  for (let i = 1; i < points.length; i++) {
    const distance = Math.abs(points[i].x - x);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

export interface TrendSummary {
  count: number;
  minSystolic: number;
  maxSystolic: number;
  minDiastolic: number;
  maxDiastolic: number;
  avgSystolic: number;
  avgDiastolic: number;
  latest: BpReading;
  /** Readings in the window that sit at an above-target level or higher. */
  aboveTargetCount: number;
}

const ABOVE_TARGET: BpLevel[] = ["amber", "red", "emergency"];

/** Descriptive statistics only. Null for an empty window. */
export function summariseTrend(windowed: BpReading[]): TrendSummary | null {
  if (windowed.length === 0) return null;
  const sys = windowed.map((r) => r.systolic);
  const dia = windowed.map((r) => r.diastolic);
  const mean = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return {
    count: windowed.length,
    minSystolic: Math.min(...sys),
    maxSystolic: Math.max(...sys),
    minDiastolic: Math.min(...dia),
    maxDiastolic: Math.max(...dia),
    avgSystolic: mean(sys),
    avgDiastolic: mean(dia),
    latest: windowed[windowed.length - 1],
    aboveTargetCount: windowed.filter((r) => ABOVE_TARGET.includes(r.level)).length,
  };
}

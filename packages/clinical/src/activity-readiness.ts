/**
 * Training load, recovery and sleep bands from stored wearable readings (S48b, spec 5.6).
 *
 * PURE and deterministic (INV-01): no language model, no clock read (the caller passes `now`), no I/O. The windows end yesterday (Lagos), so a day that is still filling up is never counted. Every number is in the versioned PROPOSED
 * config `activity.readiness_bands` (owner: CMO), so nothing here is a hard-coded threshold.
 *
 * What it is: a plain comparison of the last few days of a person's OWN device data against their OWN usual. It never ranks one person against
 * another, never says "push harder", and never changes what the activity safety gate allows (the gate is the only thing that decides that).
 * It is an estimate from a consumer device, always labelled so. With no data, or too little, it says nothing at all: dormant until real
 * provider data exists.
 *
 * The reading types are the ones apps/web/src/lib/wearables/normalise.ts writes to wearable_readings.
 */
export type ReadinessMetric = "recovery_score" | "hrv_ms" | "sleep_minutes" | "strain" | "steps";

export interface WearableReadingPoint {
  readonly readingType: string;
  readonly value: number;
  /** ISO-8601 instant the metric describes. */
  readonly recordedAt: string;
}

export interface ReadinessBandsConfig {
  readonly recent_days: number;
  readonly baseline_days: number;
  readonly min_recent_days: number;
  readonly min_baseline_days: number;
  readonly usual_band_pct: number;
  readonly load: { readonly acute_days: number; readonly chronic_days: number; readonly min_chronic_days: number; readonly light_ratio: number; readonly heavy_ratio: number };
}

export type ReadinessLevel = "lower" | "usual" | "higher";
export type LoadLevel = "lighter" | "usual" | "heavier";

export interface ReadinessBand<L extends string> {
  readonly metric: ReadinessMetric;
  readonly level: L;
}

export interface ReadinessResult {
  /** `no_data` means: say nothing (no device data, or too little to compare). */
  readonly state: "no_data" | "ready";
  readonly recovery: ReadinessBand<ReadinessLevel> | null;
  readonly sleep: ReadinessBand<ReadinessLevel> | null;
  readonly load: ReadinessBand<LoadLevel> | null;
  /** Always true: this is an estimate from a consumer device. */
  readonly estimate: true;
}

const DAY_MS = 86_400_000;
const NONE: ReadinessResult = { state: "no_data", recovery: null, sleep: null, load: null, estimate: true };

/** Lagos calendar day (UTC+1, no DST) as a day number since the epoch; null for an unreadable instant. */
function lagosDay(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor((ms + 3_600_000) / DAY_MS) : null;
}

/** One value per Lagos day: steps are a running total so the day's largest wins, sleep adds up, everything else is the day's mean. */
function perDay(readings: readonly WearableReadingPoint[], type: ReadinessMetric): Map<number, number> {
  const groups = new Map<number, number[]>();
  for (const r of readings) {
    if (r.readingType !== type || !Number.isFinite(r.value) || r.value < 0) continue;
    const d = lagosDay(r.recordedAt);
    if (d === null) continue;
    groups.set(d, [...(groups.get(d) ?? []), r.value]);
  }
  const out = new Map<number, number>();
  for (const [d, vals] of groups) {
    out.set(d, type === "steps" ? Math.max(...vals) : type === "sleep_minutes" ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return out;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Mean of the days inside [from, to] and how many days had a value. */
function window(days: Map<number, number>, from: number, to: number): { mean: number; n: number } | null {
  const vals: number[] = [];
  for (const [d, v] of days) if (d >= from && d <= to) vals.push(v);
  return vals.length === 0 ? null : { mean: mean(vals), n: vals.length };
}

function compare(days: Map<number, number>, today: number, cfg: ReadinessBandsConfig): ReadinessLevel | null {
  const recent = window(days, today - cfg.recent_days + 1, today);
  const base = window(days, today - cfg.baseline_days, today - cfg.recent_days);
  if (!recent || !base || recent.n < cfg.min_recent_days || base.n < cfg.min_baseline_days || base.mean <= 0) return null;
  const pct = ((recent.mean - base.mean) / base.mean) * 100;
  return pct < -cfg.usual_band_pct ? "lower" : pct > cfg.usual_band_pct ? "higher" : "usual";
}

export function assessReadiness(readings: readonly WearableReadingPoint[], now: Date, cfg: ReadinessBandsConfig): ReadinessResult {
  const nowDay = lagosDay(now.toISOString());
  if (nowDay === null || readings.length === 0) return NONE;
  // Windows end at the last COMPLETE Lagos day: today is still filling up (steps so far, sleep not yet synced) and would drag every band down.
  const today = nowDay - 1;

  let recovery: ReadinessBand<ReadinessLevel> | null = null;
  for (const metric of ["recovery_score", "hrv_ms"] as const) {
    const level = compare(perDay(readings, metric), today, cfg);
    if (level) {
      recovery = { metric, level };
      break;
    }
  }

  const sleepLevel = compare(perDay(readings, "sleep_minutes"), today, cfg);
  const sleep = sleepLevel ? ({ metric: "sleep_minutes", level: sleepLevel } as const) : null;

  let load: ReadinessBand<LoadLevel> | null = null;
  for (const metric of ["strain", "steps"] as const) {
    const days = perDay(readings, metric);
    const acute = window(days, today - cfg.load.acute_days + 1, today);
    const chronic = window(days, today - cfg.load.chronic_days + 1, today);
    if (!acute || !chronic || chronic.n < cfg.load.min_chronic_days || chronic.mean <= 0) continue;
    const ratio = acute.mean / chronic.mean;
    load = { metric, level: ratio < cfg.load.light_ratio ? "lighter" : ratio > cfg.load.heavy_ratio ? "heavier" : "usual" };
    break;
  }

  if (!recovery && !sleep && !load) return NONE;
  return { state: "ready", recovery, sleep, load, estimate: true };
}

/** i18n keys (packages/i18n en). Wording is descriptive only: it never tells anyone to do more. */
export function readinessMessageKeys(r: ReadinessResult): { recovery: string | null; sleep: string | null; load: string | null } {
  return {
    recovery: r.recovery ? `activity.readiness.recovery.${r.recovery.level}` : null,
    sleep: r.sleep ? `activity.readiness.sleep.${r.sleep.level}` : null,
    load: r.load ? `activity.readiness.load.${r.load.level}` : null,
  };
}

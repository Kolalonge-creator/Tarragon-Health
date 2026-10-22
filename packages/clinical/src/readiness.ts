/**
 * S47b (BUILD-SPEC-v5 4.6): the daily readiness line for a person who already wears a device. A plain-language band built only from what the device has
 * already stored (sleep, heart rate variability, resting heart rate), compared with the person's OWN recent usual.
 *
 * What it is NOT: a medical claim, a score, a ranking against other people, a diagnosis or a reason to change a medicine. It is always labelled an
 * estimate by the screen. There is no language model here (INV-01 spirit) and no clock: `nowMs` is an input.
 *
 * Dormant by construction: no device, switched off, no data newer than `max_age_hours`, too few days of history or fewer than `min_signals` signals
 * all return `none`, and the screen then shows nothing at all, not even an empty card.
 *
 * Bands: "take_it_easier" when at least two signals moved the unhelpful way against the person's usual; "rested" when none did and at least one moved the
 * helpful way; otherwise "steady". Every number comes from the versioned configuration `today.home_cards`.readiness.
 */
import { lagosDateKey } from "./dates";

export type ReadinessBand = "steady" | "take_it_easier" | "rested";
export type ReadinessSignal = "sleep" | "hrv" | "resting_hr";
export type ReadinessNoneReason = "switched_off" | "no_device" | "no_recent_data" | "not_enough_history" | "not_enough_signals";

export interface ReadinessConfig {
  readonly enabled: boolean;
  readonly maxAgeHours: number;
  readonly baselineDays: number;
  readonly minBaselineDays: number;
  readonly minSignals: number;
  readonly sleepDropPct: number;
  readonly hrvDropPct: number;
  readonly hrvRisePct: number;
  readonly restingHrRiseBpm: number;
}

export class ReadinessConfigError extends Error {}

function positive(raw: Record<string, unknown>, field: string, allowZero = false): number {
  const v = raw[field];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || (!allowZero && v === 0)) throw new ReadinessConfigError(`readiness.${field} must be a positive number`);
  return v;
}

/** Reads the readiness part of the `today.home_cards` configuration, or throws. */
export function parseReadinessConfig(value: unknown): ReadinessConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ReadinessConfigError("readiness must be an object");
  const raw = value as Record<string, unknown>;
  if (typeof raw["enabled"] !== "boolean") throw new ReadinessConfigError("readiness.enabled must be true or false");
  const cfg: ReadinessConfig = {
    enabled: raw["enabled"],
    maxAgeHours: positive(raw, "max_age_hours"),
    baselineDays: positive(raw, "baseline_days"),
    minBaselineDays: positive(raw, "min_baseline_days"),
    minSignals: positive(raw, "min_signals"),
    sleepDropPct: positive(raw, "sleep_drop_pct"),
    hrvDropPct: positive(raw, "hrv_drop_pct"),
    hrvRisePct: positive(raw, "hrv_rise_pct"),
    restingHrRiseBpm: positive(raw, "resting_hr_rise_bpm"),
  };
  if (cfg.minSignals > 3) throw new ReadinessConfigError("readiness.min_signals cannot be more than the 3 signals there are");
  if (cfg.minBaselineDays > cfg.baselineDays) throw new ReadinessConfigError("readiness.min_baseline_days cannot be more than baseline_days");
  return cfg;
}

export interface TimedValue {
  readonly atMs: number;
  readonly value: number;
}

export interface ReadinessInput {
  readonly nowMs: number;
  readonly hasDevice: boolean;
  /** Minutes of sleep per night, as the device stored them. */
  readonly sleepMinutes: readonly TimedValue[];
  /** Heart rate variability in milliseconds. */
  readonly hrvMs: readonly TimedValue[];
  /** Resting heart rate in beats a minute. */
  readonly restingHr: readonly TimedValue[];
}

export type SignalMove = "helpful" | "unhelpful" | "level";

export type ReadinessResult =
  | { readonly kind: "none"; readonly reason: ReadinessNoneReason }
  | {
      readonly kind: "band";
      readonly band: ReadinessBand;
      /** Which signals moved, in a fixed order, for the plain-words reasons. Only signals that moved are listed. */
      readonly moves: readonly { readonly signal: ReadinessSignal; readonly move: Exclude<SignalMove, "level"> }[];
    };

const HOUR_MS = 3_600_000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** One value per Lagos day (the latest that day), newest first, and only values that are real numbers. */
function perDay(list: readonly TimedValue[], nowMs: number): { dateKey: string; atMs: number; value: number }[] {
  const byDay = new Map<string, { dateKey: string; atMs: number; value: number }>();
  for (const v of list) {
    if (!Number.isFinite(v.atMs) || !Number.isFinite(v.value) || v.atMs > nowMs) continue;
    const dateKey = lagosDateKey(v.atMs);
    const have = byDay.get(dateKey);
    if (!have || v.atMs > have.atMs) byDay.set(dateKey, { dateKey, atMs: v.atMs, value: v.value });
  }
  return [...byDay.values()].sort((a, b) => b.atMs - a.atMs);
}

interface SignalReading {
  readonly latest: number;
  readonly usual: number;
}

/** The latest value (not older than the allowed age) and the person's usual: the median of the earlier days in the baseline window. */
function readSignal(list: readonly TimedValue[], input: ReadinessInput, cfg: ReadinessConfig): { fresh: boolean; enoughHistory: boolean; reading: SignalReading | null } {
  const days = perDay(list, input.nowMs);
  const latest = days[0];
  if (!latest || input.nowMs - latest.atMs > cfg.maxAgeHours * HOUR_MS) return { fresh: false, enoughHistory: false, reading: null };
  const earliestMs = input.nowMs - cfg.baselineDays * 24 * HOUR_MS;
  const earlier = days.slice(1).filter((d) => d.atMs >= earliestMs);
  if (earlier.length < cfg.minBaselineDays) return { fresh: true, enoughHistory: false, reading: null };
  return { fresh: true, enoughHistory: true, reading: { latest: latest.value, usual: median(earlier.map((d) => d.value)) } };
}

const pctChange = (r: SignalReading): number => ((r.latest - r.usual) / r.usual) * 100;

export function computeReadiness(cfg: ReadinessConfig, input: ReadinessInput): ReadinessResult {
  if (!cfg.enabled) return { kind: "none", reason: "switched_off" };
  if (!input.hasDevice) return { kind: "none", reason: "no_device" };

  const sleep = readSignal(input.sleepMinutes, input, cfg);
  const hrv = readSignal(input.hrvMs, input, cfg);
  const rhr = readSignal(input.restingHr, input, cfg);
  if (!sleep.fresh && !hrv.fresh && !rhr.fresh) return { kind: "none", reason: "no_recent_data" };
  if (!sleep.reading && !hrv.reading && !rhr.reading) return { kind: "none", reason: "not_enough_history" };

  const moves: { signal: ReadinessSignal; move: SignalMove }[] = [];
  if (sleep.reading && sleep.reading.usual > 0) {
    moves.push({ signal: "sleep", move: pctChange(sleep.reading) <= -cfg.sleepDropPct ? "unhelpful" : "level" });
  }
  if (hrv.reading && hrv.reading.usual > 0) {
    const change = pctChange(hrv.reading);
    moves.push({ signal: "hrv", move: change <= -cfg.hrvDropPct ? "unhelpful" : change >= cfg.hrvRisePct ? "helpful" : "level" });
  }
  if (rhr.reading) {
    moves.push({ signal: "resting_hr", move: rhr.reading.latest - rhr.reading.usual >= cfg.restingHrRiseBpm ? "unhelpful" : "level" });
  }
  if (moves.length < cfg.minSignals) return { kind: "none", reason: "not_enough_signals" };

  const unhelpful = moves.filter((m) => m.move === "unhelpful").length;
  const helpful = moves.filter((m) => m.move === "helpful").length;
  const band: ReadinessBand = unhelpful >= 2 ? "take_it_easier" : unhelpful === 0 && helpful >= 1 ? "rested" : "steady";
  return {
    kind: "band",
    band,
    moves: moves.filter((m): m is { signal: ReadinessSignal; move: "helpful" | "unhelpful" } => m.move !== "level"),
  };
}

/**
 * Continuous glucose profile (the ambulatory glucose profile layout): fourteen days of sensor readings folded onto one 24 hour clock, with the
 * range bands, the headline numbers and the time-of-day patterns a care team looks for. DISPLAY ONLY: nothing here creates a task, a page or an
 * escalation (the sustained-event rules in `@tarragon/shared` cgm-events stay the only CGM safety path), and the words it produces describe
 * readings, never a cause and never a dose. Deterministic arithmetic, no model.
 *
 * Every number that a clinician could reasonably want to change (window, bin size, band edges, how much data is enough, when a time of day counts
 * as a pattern) comes from the PROPOSED configuration `devices.cgm_agp`, never from this file. Readings are stored in mmol/L; converting for
 * display is the caller's job.
 */
import { GLUCOSE_MMOL_TO_MGDL, getProposedConfig } from "@tarragon/shared";

export interface AgpConfig {
  window_days: number;
  timezone: string;
  bin_minutes: number;
  slot_minutes: number;
  min_active_pct: number;
  min_days_with_data: number;
  min_readings_per_bin: number;
  band_edges_mmol_l: { very_low: number; low: number; high: number; very_high: number };
  percentiles: { lower: number; upper: number };
  pattern: { min_run_minutes: number; low_share_pct: number; high_share_pct: number };
}

export function loadAgpConfig(asOf?: string): { config: AgpConfig; version: number } {
  const r = getProposedConfig("devices.cgm_agp", asOf);
  return { config: r.value as unknown as AgpConfig, version: r.version };
}

export interface AgpSample {
  takenAt: string;
  mmolL: number;
}

export interface AgpBin {
  /** Minutes after local midnight at which the bin starts. */
  startMinute: number;
  n: number;
  lower: number | null;
  upper: number | null;
  mean: number | null;
  /** Share of readings in the bin below the low edge / above the high edge, 0 to 1. */
  shareLow: number | null;
  shareHigh: number | null;
}

export interface TimeInBands {
  veryLowPct: number;
  lowPct: number;
  inRangePct: number;
  highPct: number;
  veryHighPct: number;
}

export interface AgpMetrics {
  count: number;
  daysWithData: number;
  /** Share of the 15 minute slots in the window that hold at least one reading, 0 to 100. */
  activePct: number;
  meanMmolL: number | null;
  sdMmolL: number | null;
  cvPct: number | null;
  /** Glucose management indicator in percent (Bergenstal 2018), only when the data is enough. */
  gmiPct: number | null;
  tir: TimeInBands | null;
}

export type AgpPatternKind = "low" | "high";

export interface AgpPattern {
  kind: AgpPatternKind;
  /** Local minutes after midnight. `endMinute` may be smaller than `startMinute` when the window crosses midnight. */
  startMinute: number;
  endMinute: number;
  /** The largest share, 0 to 100, of readings in any bin of the window that were low (or high). */
  peakSharePct: number;
}

export interface AgpResult {
  bins: AgpBin[];
  metrics: AgpMetrics;
  /** True when there is enough data to draw the profile and name patterns. Below that the numbers are shown as partial, never as a profile. */
  sufficient: boolean;
  patterns: AgpPattern[];
  configVersion: number;
}

/** Africa/Lagos is UTC+1 all year with no daylight saving (the platform timezone, see getProposedConfig's own `today`). */
const LAGOS_OFFSET_MINUTES = 60;
const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;

/** Reading precision of a meter and of the triage rules: 3.88 is 3.9, so it is in range. */
const atMeterPrecision = (v: number): number => Math.round(v * 10) / 10;

/** Linear-interpolation percentile (the usual "type 7"); `sortedAsc` must be sorted and non-empty. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sortedAsc[0] as number;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sortedAsc[lo] as number;
  const b = sortedAsc[hi] as number;
  return a + (b - a) * (rank - lo);
}

/** Rounds shares to whole percents that add to exactly 100 (largest remainder), so a stacked bar never overflows or leaves a gap. */
export function roundShares(counts: readonly number[]): number[] {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((s, f) => s + f, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] as number) + 1;
    left -= 1;
  }
  return floors;
}

function localParts(takenMs: number): { day: number; minuteOfDay: number } {
  const local = Math.floor(takenMs / MINUTE_MS) + LAGOS_OFFSET_MINUTES;
  return { day: Math.floor(local / DAY_MINUTES), minuteOfDay: ((local % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES };
}

function bandOf(v: number, e: AgpConfig["band_edges_mmol_l"]): keyof TimeInBands {
  const x = atMeterPrecision(v);
  if (x < e.very_low) return "veryLowPct";
  if (x < e.low) return "lowPct";
  if (x > e.very_high) return "veryHighPct";
  if (x > e.high) return "highPct";
  return "inRangePct";
}

/**
 * Folds `samples` taken in the `window_days` before `nowMs` into the profile. Readings outside the window, with a bad timestamp, a non-positive
 * value, or a repeated timestamp are ignored. `nowMs` is a parameter so a Server Component never reads the clock in render and tests are exact.
 */
export function computeAgp(samples: readonly AgpSample[], nowMs: number, loaded = loadAgpConfig()): AgpResult {
  const { config, version } = loaded;
  const windowMs = config.window_days * DAY_MINUTES * MINUTE_MS;
  const startMs = nowMs - windowMs;
  const edges = config.band_edges_mmol_l;
  const binCount = DAY_MINUTES / config.bin_minutes;

  const seen = new Set<number>();
  const values: number[] = [];
  const perBin: number[][] = Array.from({ length: binCount }, () => []);
  const days = new Set<number>();
  const slots = new Set<number>();
  const counts: Record<keyof TimeInBands, number> = { veryLowPct: 0, lowPct: 0, inRangePct: 0, highPct: 0, veryHighPct: 0 };

  for (const s of samples) {
    const t = Date.parse(s.takenAt);
    if (!Number.isFinite(t) || t < startMs || t > nowMs) continue;
    if (!Number.isFinite(s.mmolL) || s.mmolL <= 0) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    values.push(s.mmolL);
    const { day, minuteOfDay } = localParts(t);
    days.add(day);
    slots.add(Math.floor((t - startMs) / (config.slot_minutes * MINUTE_MS)));
    (perBin[Math.floor(minuteOfDay / config.bin_minutes)] as number[]).push(s.mmolL);
    counts[bandOf(s.mmolL, edges)] += 1;
  }

  const totalSlots = (config.window_days * DAY_MINUTES) / config.slot_minutes;
  const activePct = Math.round((slots.size / totalSlots) * 1000) / 10;
  const sufficient = values.length > 0 && activePct >= config.min_active_pct && days.size >= config.min_days_with_data;

  const bins: AgpBin[] = perBin.map((vals, i) => {
    const startMinute = i * config.bin_minutes;
    if (vals.length === 0) return { startMinute, n: 0, lower: null, upper: null, mean: null, shareLow: null, shareHigh: null };
    const sorted = [...vals].sort((a, b) => a - b);
    const low = vals.filter((v) => atMeterPrecision(v) < edges.low).length;
    const high = vals.filter((v) => atMeterPrecision(v) > edges.high).length;
    return {
      startMinute,
      n: vals.length,
      lower: percentile(sorted, config.percentiles.lower),
      upper: percentile(sorted, config.percentiles.upper),
      mean: vals.reduce((s, v) => s + v, 0) / vals.length,
      shareLow: low / vals.length,
      shareHigh: high / vals.length,
    };
  });

  const count = values.length;
  const mean = count > 0 ? values.reduce((s, v) => s + v, 0) / count : null;
  const sd = mean === null ? null : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / count);
  const shares = roundShares([counts.veryLowPct, counts.lowPct, counts.inRangePct, counts.highPct, counts.veryHighPct]);
  const metrics: AgpMetrics = {
    count,
    daysWithData: days.size,
    activePct,
    meanMmolL: mean,
    sdMmolL: sd,
    cvPct: mean && sd !== null ? (sd / mean) * 100 : null,
    gmiPct: sufficient && mean !== null ? 3.31 + 0.02392 * (mean * GLUCOSE_MMOL_TO_MGDL) : null,
    tir:
      count === 0
        ? null
        : {
            veryLowPct: shares[0] as number,
            lowPct: shares[1] as number,
            inRangePct: shares[2] as number,
            highPct: shares[3] as number,
            veryHighPct: shares[4] as number,
          },
  };

  return { bins, metrics, sufficient, patterns: sufficient ? findPatterns(bins, config) : [], configVersion: version };
}

/**
 * Named time-of-day windows: runs of consecutive bins (wrapping past midnight) where, in every bin, enough days were recorded and at least the
 * configured share of readings were low (or high), lasting at least the configured length. A bin that is both is counted for each kind.
 */
export function findPatterns(bins: readonly AgpBin[], config: AgpConfig): AgpPattern[] {
  const out: AgpPattern[] = [];
  const kinds: { kind: AgpPatternKind; share: (b: AgpBin) => number | null; pct: number }[] = [
    { kind: "low", share: (b) => b.shareLow, pct: config.pattern.low_share_pct },
    { kind: "high", share: (b) => b.shareHigh, pct: config.pattern.high_share_pct },
  ];
  const n = bins.length;
  for (const { kind, share, pct } of kinds) {
    const flagged = bins.map((b) => b.n >= config.min_readings_per_bin && (share(b) ?? 0) * 100 >= pct);
    if (!flagged.some(Boolean)) continue;
    const peak = (idx: number[]) => Math.round(Math.max(...idx.map((i) => (share(bins[i] as AgpBin) ?? 0) * 100)));
    if (flagged.every(Boolean)) {
      out.push({ kind, startMinute: 0, endMinute: 0, peakSharePct: peak(bins.map((_, i) => i)) });
      continue;
    }
    // Start scanning just after an unflagged bin so a run that crosses midnight is one run, not two.
    const origin = flagged.findIndex((f) => !f);
    let run: number[] = [];
    const close = () => {
      if (run.length * config.bin_minutes >= config.pattern.min_run_minutes) {
        const first = bins[run[0] as number] as AgpBin;
        const last = bins[run[run.length - 1] as number] as AgpBin;
        out.push({
          kind,
          startMinute: first.startMinute,
          endMinute: (last.startMinute + config.bin_minutes) % DAY_MINUTES,
          peakSharePct: peak(run),
        });
      }
      run = [];
    };
    for (let step = 1; step <= n; step++) {
      const i = (origin + step) % n;
      if (flagged[i]) run.push(i);
      else close();
    }
    close();
  }
  return out.sort((a, b) => a.startMinute - b.startMinute);
}

/** "18:30" for 1110. */
export function clockLabel(minuteOfDay: number): string {
  const m = ((minuteOfDay % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

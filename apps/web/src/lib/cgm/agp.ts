/**
 * Continuous glucose profile (the ambulatory glucose profile layout): fourteen days of sensor readings folded onto one 24 hour clock, with the
 * range bands, the headline numbers and the time-of-day patterns a care team looks for. DISPLAY ONLY: nothing here creates a task, a page or an
 * escalation (the sustained-event rules in `@tarragon/shared` cgm-events stay the only CGM safety path), and the words it produces describe
 * readings, never a cause and never a dose. Deterministic arithmetic, no model.
 *
 * Every number that a clinician could reasonably want to change (window, bin size, time zone, band edges, how much data is enough, when a time of
 * day counts as a pattern) comes from the PROPOSED configuration `devices.cgm_agp`, never from this file. Readings are stored in mmol/L; converting
 * for display is the caller's job.
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
  dedupe_minutes: number;
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
  /** How many of the bin's readings were below the low edge / above the high edge. */
  nLow: number;
  nHigh: number;
  lower: number | null;
  upper: number | null;
  mean: number | null;
  /** nLow / n and nHigh / n, 0 to 1, for display. Decisions use the counts, never these ratios. */
  shareLow: number | null;
  shareHigh: number | null;
}

export type BandKey = "veryLowPct" | "lowPct" | "inRangePct" | "highPct" | "veryHighPct";
export type TimeInBands = Record<BandKey, number>;

export interface AgpMetrics {
  count: number;
  daysWithData: number;
  /** Share of the slots in the window that hold at least one reading, 0 to 100. */
  activePct: number;
  meanMmolL: number | null;
  sdMmolL: number | null;
  cvPct: number | null;
  /** Glucose management indicator in percent (Bergenstal 2018), only when the data is enough. */
  gmiPct: number | null;
  /** Whole percents that add to exactly 100. A band with any readings is never shown as 0. */
  tir: TimeInBands | null;
  /** The same shares unrounded, so the screen can say "<1%" for a band that has readings but rounds to nothing, and add bands up honestly. */
  tirExactPct: TimeInBands | null;
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

/** Which gate the data failed, so the screen can say the true reason: too few days, or the sensor was off for too much of the time. */
export type InsufficientReason = "days" | "coverage";

export interface AgpResult {
  bins: AgpBin[];
  metrics: AgpMetrics;
  /** True when there is enough data to draw the profile and name patterns. Below that the numbers are shown as partial, never as a profile. */
  sufficient: boolean;
  /** Null when sufficient, or when there are no readings at all. */
  insufficientReason: InsufficientReason | null;
  patterns: AgpPattern[];
  configVersion: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DAY_MINUTES = 1440;

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

/**
 * Rounds counts to whole percents that add to exactly 100 (largest remainder), so a stacked bar never overflows or leaves a gap. A count above zero
 * always gets at least one point, taken from the largest, so a real but small share (twelve low readings in four thousand) is never shown as nothing.
 */
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
  for (let i = 0; i < floors.length; i++) {
    if ((counts[i] as number) > 0 && floors[i] === 0) {
      const big = floors.indexOf(Math.max(...floors));
      floors[big] = (floors[big] as number) - 1;
      floors[i] = 1;
    }
  }
  return floors;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The reading's calendar day and minute of day in the configured zone (Africa/Lagos for this platform, always, but read from the config). */
function localParts(ms: number, timeZone: string): { day: number; minuteOfDay: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    formatters.set(timeZone, f);
  }
  const part: Record<string, number> = {};
  for (const p of f.formatToParts(ms)) if (p.type !== "literal") part[p.type] = Number(p.value);
  return {
    day: Math.floor(Date.UTC(part.year as number, (part.month as number) - 1, part.day as number) / DAY_MS),
    minuteOfDay: (part.hour as number) * 60 + (part.minute as number),
  };
}

/**
 * Which band a reading is in, judged in whole mg/dL against the consensus edges (54, 70, 180, 250). Sensors report whole mg/dL (or tenths of a
 * mmol/L, which land on the same whole numbers), and a person in mg/dL sees "180", so 181 is high and 180 is not, whichever unit they read in.
 * The edges are the configured mmol/L edges converted the same way.
 */
function bandOf(mmolL: number, e: AgpConfig["band_edges_mmol_l"]): BandKey {
  const mg = Math.round(mmolL * GLUCOSE_MMOL_TO_MGDL);
  if (mg < Math.round(e.very_low * GLUCOSE_MMOL_TO_MGDL)) return "veryLowPct";
  if (mg < Math.round(e.low * GLUCOSE_MMOL_TO_MGDL)) return "lowPct";
  if (mg > Math.round(e.very_high * GLUCOSE_MMOL_TO_MGDL)) return "veryHighPct";
  if (mg > Math.round(e.high * GLUCOSE_MMOL_TO_MGDL)) return "highPct";
  return "inRangePct";
}

const isLow = (b: BandKey): boolean => b === "veryLowPct" || b === "lowPct";
const isHigh = (b: BandKey): boolean => b === "highPct" || b === "veryHighPct";

/**
 * Folds `samples` taken in the `window_days` before `nowMs` into the profile. Readings outside the window, with a bad timestamp, or a non-positive
 * value are ignored, and a reading that follows another by less than `dedupe_minutes` is dropped (one sensor can reach us by two routes, a few
 * seconds apart). `nowMs` is a parameter so a Server Component never reads the clock in render and tests are exact.
 */
export function computeAgp(samples: readonly AgpSample[], nowMs: number, loaded = loadAgpConfig()): AgpResult {
  const { config, version } = loaded;
  const startMs = nowMs - config.window_days * DAY_MS;
  const edges = config.band_edges_mmol_l;
  const binCount = DAY_MINUTES / config.bin_minutes;

  const inWindow: { t: number; v: number }[] = [];
  for (const s of samples) {
    const t = Date.parse(s.takenAt);
    if (!Number.isFinite(t) || t < startMs || t > nowMs) continue;
    if (!Number.isFinite(s.mmolL) || s.mmolL <= 0) continue;
    inWindow.push({ t, v: s.mmolL });
  }
  inWindow.sort((a, b) => a.t - b.t);

  const values: number[] = [];
  const perBin: { v: number; band: BandKey }[][] = Array.from({ length: binCount }, () => []);
  const days = new Set<number>();
  const slots = new Set<number>();
  const counts: Record<BandKey, number> = { veryLowPct: 0, lowPct: 0, inRangePct: 0, highPct: 0, veryHighPct: 0 };
  let lastKept = Number.NEGATIVE_INFINITY;

  for (const { t, v } of inWindow) {
    if (t - lastKept < config.dedupe_minutes * MINUTE_MS) continue;
    lastKept = t;
    values.push(v);
    const { day, minuteOfDay } = localParts(t, config.timezone);
    days.add(day);
    slots.add(Math.floor((t - startMs) / (config.slot_minutes * MINUTE_MS)));
    const band = bandOf(v, edges);
    (perBin[Math.floor(minuteOfDay / config.bin_minutes)] as { v: number; band: BandKey }[]).push({ v, band });
    counts[band] += 1;
  }

  const totalSlots = (config.window_days * DAY_MINUTES) / config.slot_minutes;
  const activePct = Math.round((slots.size / totalSlots) * 1000) / 10;
  const enoughDays = days.size >= config.min_days_with_data;
  const enoughCoverage = activePct >= config.min_active_pct;
  const sufficient = values.length > 0 && enoughDays && enoughCoverage;
  const insufficientReason: InsufficientReason | null = values.length === 0 || sufficient ? null : !enoughDays ? "days" : "coverage";

  const bins: AgpBin[] = perBin.map((items, i) => {
    const startMinute = i * config.bin_minutes;
    if (items.length === 0) return { startMinute, n: 0, nLow: 0, nHigh: 0, lower: null, upper: null, mean: null, shareLow: null, shareHigh: null };
    const sorted = items.map((x) => x.v).sort((a, b) => a - b);
    const nLow = items.filter((x) => isLow(x.band)).length;
    const nHigh = items.filter((x) => isHigh(x.band)).length;
    return {
      startMinute,
      n: items.length,
      nLow,
      nHigh,
      lower: percentile(sorted, config.percentiles.lower),
      upper: percentile(sorted, config.percentiles.upper),
      mean: sorted.reduce((s, v) => s + v, 0) / items.length,
      shareLow: nLow / items.length,
      shareHigh: nHigh / items.length,
    };
  });

  const count = values.length;
  const mean = count > 0 ? values.reduce((s, v) => s + v, 0) / count : null;
  const sd = mean === null ? null : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / count);
  const order: BandKey[] = ["veryLowPct", "lowPct", "inRangePct", "highPct", "veryHighPct"];
  const shares = roundShares(order.map((k) => counts[k]));
  const metrics: AgpMetrics = {
    count,
    daysWithData: days.size,
    activePct,
    meanMmolL: mean,
    sdMmolL: sd,
    cvPct: mean && sd !== null ? (sd / mean) * 100 : null,
    gmiPct: sufficient && mean !== null ? 3.31 + 0.02392 * (mean * GLUCOSE_MMOL_TO_MGDL) : null,
    tir: count === 0 ? null : (Object.fromEntries(order.map((k, i) => [k, shares[i]])) as TimeInBands),
    tirExactPct: count === 0 ? null : (Object.fromEntries(order.map((k) => [k, (counts[k] / count) * 100])) as TimeInBands),
  };

  return { bins, metrics, sufficient, insufficientReason, patterns: sufficient ? findPatterns(bins, config) : [], configVersion: version };
}

/**
 * Named time-of-day windows: runs of consecutive bins (wrapping past midnight) where, in every bin, enough readings were recorded and at least the
 * configured share of them were low (or high), lasting at least the configured length. The share is tested on counts (`n * pct <= count * 100`),
 * never on a float ratio, so a bin exactly at the threshold is always counted. A bin that is both is counted for each kind.
 */
export function findPatterns(bins: readonly AgpBin[], config: AgpConfig): AgpPattern[] {
  const out: AgpPattern[] = [];
  const kinds: { kind: AgpPatternKind; count: (b: AgpBin) => number; pct: number }[] = [
    { kind: "low", count: (b) => b.nLow, pct: config.pattern.low_share_pct },
    { kind: "high", count: (b) => b.nHigh, pct: config.pattern.high_share_pct },
  ];
  const n = bins.length;
  for (const { kind, count, pct } of kinds) {
    const flagged = bins.map((b) => b.n >= config.min_readings_per_bin && count(b) * 100 >= pct * b.n);
    if (!flagged.some(Boolean)) continue;
    const peak = (idx: number[]) => Math.round(Math.max(...idx.map((i) => ((count(bins[i] as AgpBin) / (bins[i] as AgpBin).n) * 100))));
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

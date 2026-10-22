/**
 * A synthetic fortnight of sensor readings for tests: night highs, a midday spike and evening lows, in Lagos time. Invented numbers, no real
 * person's data. Seeded, so it is identical on every run.
 */
import type { AgpSample } from "../agp";

export const FIXTURE_NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

/** Small seeded generator so the synthetic fortnight is the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local (Lagos) hour of day, mean and spread, shaped like a fortnight with night highs, a midday spike and evening lows. Synthetic. */
function shape(localMinute: number): { mean: number; sd: number } {
  const h = localMinute / 60;
  if (h < 3.5) return { mean: 14.5, sd: 2.0 };
  if (h < 6) return { mean: 14.5 - ((h - 3.5) / 2.5) * 8, sd: 1.8 };
  if (h < 11.5) return { mean: 6.5, sd: 1.6 };
  if (h < 13) return { mean: 11.5, sd: 4.5 };
  if (h < 18) return { mean: 7.8, sd: 1.8 };
  if (h < 21.5) return { mean: 6.0, sd: 2.4 };
  return { mean: 13.0, sd: 2.2 };
}

export function fortnight(opts: { everyMin?: number; days?: number; drop?: number; seed?: number } = {}): AgpSample[] {
  const { everyMin = 5, days = 14, drop = 0, seed = 7 } = opts;
  const next = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const out: AgpSample[] = [];
  for (let t = FIXTURE_NOW - days * DAY; t <= FIXTURE_NOW; t += everyMin * MIN) {
    if (drop > 0 && next() < drop) continue;
    const local = (Math.floor(t / MIN) + 60) % 1440;
    const { mean, sd } = shape(local);
    out.push({ takenAt: iso(t), mmolL: Math.max(2.2, mean + sd * gauss()) });
  }
  return out;
}


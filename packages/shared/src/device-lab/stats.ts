/** Small, pure summary statistics for the device lab harness. Throws on bad input rather than returning NaN. */

function assertSamples(samples: readonly number[]): void {
  if (samples.length === 0) throw new Error("no samples");
  for (const s of samples) {
    if (!Number.isFinite(s)) throw new Error(`non-finite sample: ${String(s)}`);
  }
}

export function median(samples: readonly number[]): number {
  assertSamples(samples);
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] as number;
  if (sorted.length % 2 === 1) return hi;
  return (((sorted[mid - 1] as number) + hi) / 2);
}

/** Nearest-rank percentile (p in 1..100). With 5 samples p95 is the maximum, which is the honest reading of 5 runs. */
export function percentile(samples: readonly number[], p: number): number {
  assertSamples(samples);
  if (!(p > 0 && p <= 100)) throw new Error(`percentile out of range: ${p}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export interface Summary {
  readonly n: number;
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

export function summarise(samples: readonly number[]): Summary {
  assertSamples(samples);
  return {
    n: samples.length,
    min: Math.min(...samples),
    median: median(samples),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
  };
}

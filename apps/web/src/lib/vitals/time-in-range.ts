/**
 * Time-in-range (§10.3, §14.2) — a plain arithmetic summary of logged glucose,
 * NOT an ML computation (the ML "HbA1c trajectory" piece stays deferred while
 * the ML service is paused). TIR is just the share of readings inside the
 * agreed range, so it needs no model — a doctor sees it at a glance.
 */

/** Standard glucose target band for TIR (mmol/L), overridable per patient. */
export const DEFAULT_TIR_LOW = 3.9;
export const DEFAULT_TIR_HIGH = 10.0;

/** ISO timestamp N days ago — kept in a lib fn so Server Components don't call
 * Date.now() directly in render (react-hooks/purity). */
export function windowStartIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export interface TimeInRange {
  total: number;
  inRange: number;
  below: number;
  above: number;
  inRangePct: number;
  belowPct: number;
  abovePct: number;
  low: number;
  high: number;
}

export function computeTimeInRange(
  values: number[],
  opts: { low?: number; high?: number } = {},
): TimeInRange | null {
  const low = opts.low ?? DEFAULT_TIR_LOW;
  const high = opts.high ?? DEFAULT_TIR_HIGH;
  const total = values.length;
  if (total === 0) return null;

  let below = 0;
  let above = 0;
  let inRange = 0;
  for (const v of values) {
    if (v < low) below += 1;
    else if (v > high) above += 1;
    else inRange += 1;
  }
  const pct = (n: number) => Math.round((n / total) * 100);
  return {
    total,
    inRange,
    below,
    above,
    inRangePct: pct(inRange),
    belowPct: pct(below),
    abovePct: pct(above),
    low,
    high,
  };
}

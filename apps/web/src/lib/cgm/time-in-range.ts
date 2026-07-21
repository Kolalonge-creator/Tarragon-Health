/**
 * Time-in-range for CGM glucose readings — a DISPLAY-ONLY coaching summary, not
 * a clinical measurement or an escalation input. Pure module (no server-only,
 * no network) so it is unit-testable.
 *
 * Standard consensus glucose targets (mmol/L): in-range 3.9–10.0, below 3.9 is
 * low, above 10.0 is high. Readings are stored in vitals_readings.glucose_mmol_l.
 */

export const TIR_LOW_MMOL_L = 3.9;
export const TIR_HIGH_MMOL_L = 10.0;

export interface TimeInRange {
  count: number;
  inRangePct: number;
  lowPct: number;
  highPct: number;
}

export function computeTimeInRange(
  readings: { glucose_mmol_l: number | null }[],
): TimeInRange {
  const values = readings
    .map((r) => r.glucose_mmol_l)
    .filter((v): v is number => typeof v === "number");

  const count = values.length;
  if (count === 0) {
    return { count: 0, inRangePct: 0, lowPct: 0, highPct: 0 };
  }

  let low = 0;
  let high = 0;
  let inRange = 0;
  for (const v of values) {
    if (v < TIR_LOW_MMOL_L) low += 1;
    else if (v > TIR_HIGH_MMOL_L) high += 1;
    else inRange += 1;
  }

  const pct = (n: number) => Math.round((n / count) * 100);
  return {
    count,
    inRangePct: pct(inRange),
    lowPct: pct(low),
    highPct: pct(high),
  };
}

/**
 * Detects the post-ovulation temperature rise in a run of basal body
 * temperatures.
 *
 * Progesterone, released after ovulation, raises resting temperature by
 * roughly 0.3 C and holds it there for the rest of the cycle. The standard
 * reading of that is the "3 over 6" rule used by fertility-awareness
 * methods: three consecutive temperatures all above the highest of the six
 * days before them, with the third at least 0.2 C above that baseline.
 *
 * ## This confirms, it never predicts
 *
 * The shift is only visible AFTER it has happened, so by the time this
 * returns a date the fertile window has already closed. It is therefore
 * useful for one thing — telling a patient that she did appear to ovulate
 * this cycle — and dangerous for another: it must never be rendered as a
 * fertile-window prediction, and it is not a contraceptive method. See
 * THERMAL_SHIFT_DISCLAIMER.
 *
 * Pure, no clock reads, no DB.
 */

/** Consecutive high readings required. */
const HIGH_RUN_LENGTH = 3;

/** Days of baseline the run must clear. */
const BASELINE_WINDOW = 6;

/** How far above baseline the third high reading must sit, in Celsius. */
const REQUIRED_RISE_C = 0.2;

export const THERMAL_SHIFT_DISCLAIMER =
  "A temperature rise suggests ovulation has already happened, so it confirms rather than predicts. It is not a contraceptive method.";

export interface TemperatureReading {
  date: string;
  /** Celsius. */
  temperature: number;
}

export interface ThermalShiftResult {
  detected: boolean;
  /**
   * Best estimate of the ovulation date: the day before the first of the
   * three high readings. Null when nothing is detected.
   */
  estimatedOvulationDate: string | null;
  /** The first of the three consecutive high readings. */
  shiftStartDate: string | null;
  /** Highest of the six baseline days the run had to clear. */
  baselineHigh: number | null;
  /** How far the third high reading sat above that baseline, in Celsius. */
  riseC: number | null;
  /** Why no shift was reported, for honest UI copy. */
  reason: "detected" | "not_enough_readings" | "no_sustained_rise";
}

function notDetected(reason: ThermalShiftResult["reason"]): ThermalShiftResult {
  return {
    detected: false,
    estimatedOvulationDate: null,
    shiftStartDate: null,
    baselineHigh: null,
    riseC: null,
    reason,
  };
}

function previousDay(isoDate: string): string {
  return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * @param readings Temperatures within ONE cycle, any order. Passing more
 * than one cycle would let the previous cycle's luteal temperatures act as
 * a baseline and hide the next shift, so callers slice per cycle.
 */
export function detectThermalShift(readings: TemperatureReading[]): ThermalShiftResult {
  const sorted = [...readings]
    .filter((r) => r && Number.isFinite(r.temperature))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < BASELINE_WINDOW + HIGH_RUN_LENGTH) {
    return notDetected("not_enough_readings");
  }

  // Walk every position where a full baseline sits behind a full run.
  for (let i = BASELINE_WINDOW; i + HIGH_RUN_LENGTH <= sorted.length; i += 1) {
    const baseline = sorted.slice(i - BASELINE_WINDOW, i);
    const run = sorted.slice(i, i + HIGH_RUN_LENGTH);
    const baselineHigh = Math.max(...baseline.map((r) => r.temperature));

    const allAbove = run.every((r) => r.temperature > baselineHigh);
    if (!allAbove) continue;

    const rise = run[HIGH_RUN_LENGTH - 1].temperature - baselineHigh;
    if (rise < REQUIRED_RISE_C) continue;

    return {
      detected: true,
      // Ovulation is conventionally dated to the day before the rise, since
      // the temperature only lifts once progesterone is already climbing.
      estimatedOvulationDate: previousDay(run[0].date),
      shiftStartDate: run[0].date,
      baselineHigh: Math.round(baselineHigh * 100) / 100,
      riseC: Math.round(rise * 100) / 100,
      reason: "detected",
    };
  }

  return notDetected("no_sustained_rise");
}

export function describeThermalShift(result: ThermalShiftResult): string {
  switch (result.reason) {
    case "detected":
      return `Your temperature rose ${result.riseC?.toFixed(2)} C and stayed up, which usually follows ovulation. Best estimate: around ${new Date(
        `${result.estimatedOvulationDate}T00:00:00Z`
      ).toLocaleDateString(undefined, { day: "numeric", month: "short" })}.`;
    case "not_enough_readings":
      return "Log your temperature each morning before getting up. After about nine days we can look for the rise that follows ovulation.";
    case "no_sustained_rise":
      return "No sustained temperature rise yet this cycle. That is common, and a single cycle without one does not mean much on its own.";
  }
}

import { getProposedConfig, UnknownConfigKeyError } from "./proposed-config";
import type { GlucoseDisplayUnit } from "./index";

/** Same constant as GLUCOSE_MMOL_TO_MGDL in index.ts (not imported: index re-exports this file). trend-bands.test.ts fails if they drift. */
export const BAND_MMOL_TO_MGDL = 18.0182;

/**
 * S47a (BUILD-SPEC-v5 4.6): the target band drawn on a trend chart. Glucose uses the usual time-in-range band (3.9 to 10.0 mmol/L, the same numbers
 * apps/web/src/lib/vitals/time-in-range.ts already uses); weight uses the healthy BMI band at the person's own height (WHO 18.5 to 24.9). Both are
 * PROPOSED config (observations.target_bands) until the CMO confirms them. A band describes a range on the chart, in words as well as shading; the
 * chart never calls a person's trend good or bad, and a care-team target for the person replaces the standard one when one is passed in.
 */
export interface TargetBandConfig {
  readonly glucose_mmol_l: { readonly low: number; readonly high: number };
  readonly healthy_bmi: { readonly low: number; readonly high: number };
}

export interface TrendBand {
  readonly low: number;
  readonly high: number;
  /** Where the band comes from, so the caption never claims a care-team target the person does not have. */
  readonly origin: "standard" | "care_team";
}

function bandConfig(): TargetBandConfig {
  try {
    return getProposedConfig("observations.target_bands").value as unknown as TargetBandConfig;
  } catch (e) {
    if (!(e instanceof UnknownConfigKeyError)) throw e;
    return getProposedConfig("observations.target_bands", "9999-12-31").value as unknown as TargetBandConfig;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The glucose band in the unit the chart plots. `override` is a care-team band in mmol/L. */
export function glucoseTrendBand(unit: GlucoseDisplayUnit, override?: { low: number; high: number } | null): TrendBand {
  const src = override ?? bandConfig().glucose_mmol_l;
  // mg/dL is a whole number on a meter, mmol/L carries one decimal
  const conv = (mmol: number) => (unit === "mg_dl" ? Math.round(mmol * BAND_MMOL_TO_MGDL) : round1(mmol));
  return {
    low: conv(src.low),
    high: conv(src.high),
    origin: override ? "care_team" : "standard",
  };
}

/** The weight band in kg for a height in cm, or null when no usable height is on file (the chart then draws no band, never a guessed one). */
export function weightTrendBand(heightCm: number | null | undefined): TrendBand | null {
  if (typeof heightCm !== "number" || !Number.isFinite(heightCm) || heightCm < 50 || heightCm > 250) return null;
  const m = heightCm / 100;
  const { low, high } = bandConfig().healthy_bmi;
  return { low: round1(low * m * m), high: round1(high * m * m), origin: "standard" };
}

/** The sentence under the chart that names the band, so the colour is never the only signal. */
export function bandCaption(kind: "glucose" | "weight", band: TrendBand, unitLabel: string): string {
  const who = band.origin === "care_team" ? "your care team's target range" : "the usual target range";
  const what = kind === "glucose" ? "Glucose" : "Weight";
  return `The shaded band is ${who}: ${what.toLowerCase()} between ${band.low} and ${band.high} ${unitLabel}. A reading outside the band is not a diagnosis; your care team looks at the whole pattern.`;
}

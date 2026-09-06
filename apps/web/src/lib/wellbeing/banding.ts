/**
 * Deterministic labels for the wellbeing dashboard tiles (Module 46 §46.2).
 * Pure — no AI, no DB access — mirrors the vitals red-flag classifiers being
 * plain functions of an already-recorded value. This is self-report
 * engagement telemetry, not a clinical instrument (that's
 * mental-health-screening.ts) — a low score here never raises an alert.
 */

export type WellbeingBand = "attention" | "moderate" | "stable";

const BAND_LABEL: Record<WellbeingBand, string> = {
  attention: "Needs attention",
  moderate: "Moderate",
  stable: "Stable",
};

/** 1–5 self-report scale → band. Used for mood and sleep quality, where a
 * higher score means better (5 = great mood / great sleep). */
export function bandHigherIsBetter(score: number): WellbeingBand {
  if (score <= 2) return "attention";
  if (score === 3) return "moderate";
  return "stable";
}

/** 1–5 self-report scale → band, inverted. Used for stress, where a higher
 * score means worse (5 = very stressed). */
export function bandLowerIsBetter(score: number): WellbeingBand {
  if (score >= 4) return "attention";
  if (score === 3) return "moderate";
  return "stable";
}

export function wellbeingBandLabel(band: WellbeingBand): string {
  return BAND_LABEL[band];
}

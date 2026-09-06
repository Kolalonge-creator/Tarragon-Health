/**
 * Standard-normal z-score -> percentile, for DISPLAY only ("56th percentile"
 * next to a growth chart point). The z-scores themselves come from the
 * database (private.growth_z_score, computed against growth_reference_lms —
 * see 20260829121652_pediatric_growth_monitoring.sql), never recomputed here.
 *
 * The CDF approximation below (Zelen & Severo / Abramowitz & Stegun 26.2.17)
 * is a standard numerical-analysis formula, not population-specific clinical
 * data — unlike the LMS reference table itself, there is no fabrication risk
 * in shipping it. Max absolute error ~7.5e-8, far tighter than a percentile
 * display needs.
 */
export function zScoreToPercentile(z: number): number {
  const absZ = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const poly =
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const tailProbability = d * poly;
  const cdf = z >= 0 ? 1 - tailProbability : tailProbability;
  return Math.round(cdf * 1000) / 10;
}

/** "56th percentile" / "3rd percentile" — ordinal suffix for a rounded percentile. */
export function formatPercentile(percentile: number): string {
  const rounded = Math.round(percentile);
  const lastTwo = rounded % 100;
  const last = rounded % 10;
  let suffix = "th";
  if (lastTwo < 11 || lastTwo > 13) {
    if (last === 1) suffix = "st";
    else if (last === 2) suffix = "nd";
    else if (last === 3) suffix = "rd";
  }
  return `${rounded}${suffix} percentile`;
}

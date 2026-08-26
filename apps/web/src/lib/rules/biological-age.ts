import type { HealthScoreTrend } from "./health-score";

/**
 * Biological Age v1 — an illustrative, non-diagnostic reframe of the
 * existing 0-100 Health Score (lib/rules/health-score.ts) as an age
 * estimate. Signed off as a v1 presentation of the SAME underlying score,
 * not a new clinical model: there is no biomarker panel (DNA methylation,
 * PhenoAge, etc.) behind this platform, so this is deliberately a fixed,
 * transparent linear transform around a baseline score — the same
 * "simple rule, not a black box" posture health-score.ts itself documents
 * for the score it reframes.
 *
 * The gap is clamped to MAX_AGE_GAP_YEARS so even a very low score never
 * produces an alarming double-digit age gap, matching CLAUDE.md's brand
 * voice rule against fear-based framing.
 */

export interface BiologicalAgeEstimate {
  estimatedAge: number;
  /** Positive = estimate is younger than chronological age (favourable);
   * negative = older. */
  yearsYoungerThanChronological: number;
}

const SCORE_BASELINE = 70;
const YEARS_PER_SCORE_POINT = 0.25;
const MAX_AGE_GAP_YEARS = 10;

export function computeBiologicalAge(
  chronologicalAge: number,
  healthScore: number,
): BiologicalAgeEstimate {
  const rawGapYears = (healthScore - SCORE_BASELINE) * YEARS_PER_SCORE_POINT;
  const yearsYoungerThanChronological = Math.round(
    Math.max(-MAX_AGE_GAP_YEARS, Math.min(MAX_AGE_GAP_YEARS, rawGapYears)),
  );
  const estimatedAge = Math.max(0, chronologicalAge - yearsYoungerThanChronological);
  return { estimatedAge, yearsYoungerThanChronological };
}

/** Whole years between a date of birth and `now`, floor-rounded like
 * lib/rules/egfr.ts's own age-from-DOB math. */
export function ageFromDateOfBirth(dateOfBirth: string | Date, now: Date = new Date()): number {
  const dob = new Date(dateOfBirth);
  return Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Age-framed version of health-score.ts's describeHealthScoreTrend — same
 * three-branch shape (steady / improving / gentle dip), same non-alarming
 * voice, translated through computeBiologicalAge instead of the raw score.
 * Returns the same up/down orientation rules: a falling estimate (younger
 * over time) is stated plainly as good news; a rising estimate gets the
 * same "nothing to worry about" reassurance health-score.ts already gives a
 * score dip, never fear-based language either direction.
 */
export function describeBiologicalAgeTrend(
  trend: HealthScoreTrend,
  chronologicalAge: number,
): string {
  const first = computeBiologicalAge(chronologicalAge, trend.firstScore).estimatedAge;
  const last = computeBiologicalAge(chronologicalAge, trend.lastScore).estimatedAge;

  if (last === first) {
    return `Since your first check, your estimate has held steady at ${last} years.`;
  }
  if (last < first) {
    return `Since your first check, your estimate has moved from ${first} to ${last} years.`;
  }
  return `Since your first check, your estimate has moved from ${first} to ${last} years — nothing to worry about, just something worth a look with your care team.`;
}

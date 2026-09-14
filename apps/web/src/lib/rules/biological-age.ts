import type { HealthScoreTrend } from "./health-score";

/**
 * Biological Age v1 — an illustrative, non-diagnostic reframe of the existing 0-100
 * Health Score (lib/rules/health-score.ts) as an age estimate. This is NOT a validated,
 * dedicated biological-age test: there is no DNA-methylation clock (PhenoAge/GrimAge)
 * and no purpose-built biomarker composite like the ones Function Health/Elysium/TruAge
 * market. It IS, as of 2026-09-14, informed by real clinician-reviewed lab-panel status
 * (heart/kidney/liver — health-score.ts's biomarker_heart/kidney/liver components,
 * themselves reused wholesale from lib/lab-reports/biomarker-categories.ts, never a raw
 * value classified here or anywhere in this file). So "no biomarker panel behind it" is
 * no longer accurate and must not be said in any UI copy — say instead that this is not
 * a *dedicated, validated* biological-age panel/genetic test, since that's the actual
 * gap. It remains a fixed, transparent linear transform of the same score already shown
 * on HealthScoreCard — same inputs, same weighting, same "simple rule, not a black box"
 * posture health-score.ts documents for the score it reframes. Every UI surface that
 * shows this number must state the real distinction explicitly, not just imply it via a
 * "non-diagnostic" footnote — "biological age" is an established category of consumer
 * health product, and presenting a reframed wellness score under the same name without
 * that distinction stated plainly would overstate what this platform is measuring.
 *
 * health-score.ts's own v1 scope note flagged this exact gap: presenting a derived
 * "age" is a stronger patient-facing clinical claim than a 0-100 score and needs its
 * own sign-off before going live to patients — not a drive-by addition. That sign-off
 * has NOT happened as of this file's introduction (2026-09-14), nor as of the
 * biomarker-panel expansion the same day — no protocol_drafts row, no Clinical Director
 * review, nothing beyond this code existing. If anything the expansion raises the bar
 * for that review, since the underlying score now reflects more real clinical signal
 * than it did. So the patient-facing card built around this module is gated behind the
 * `biological_age_card` feature flag (migration
 * 20260914180424_biological_age_card_feature_flag.sql), defaulting to `status = 'off'`
 * — see apps/web/src/components/biological-age-card.tsx. Do not flip that flag on for
 * any rollout percentage or cohort without a real clinical sign-off first; this module
 * being merged and tested is not that sign-off.
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

/**
 * healthScore must be a finite 0-100 value (health-score.ts's ComputedHealthScore.score
 * range) and chronologicalAge a finite, non-negative number of years — both are
 * asserted rather than silently clamped, because a caller passing something outside
 * that range indicates an upstream bug (e.g. a stale/corrupt score row) that a patient
 * seeing a nonsensical age estimate would surface far more confusingly than a thrown
 * error surfaces to an engineer.
 */
export function computeBiologicalAge(
  chronologicalAge: number,
  healthScore: number,
): BiologicalAgeEstimate {
  if (!Number.isFinite(chronologicalAge) || chronologicalAge < 0) {
    throw new Error(`computeBiologicalAge: invalid chronologicalAge (${chronologicalAge})`);
  }
  if (!Number.isFinite(healthScore) || healthScore < 0 || healthScore > 100) {
    throw new Error(`computeBiologicalAge: invalid healthScore (${healthScore}), expected 0-100`);
  }

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
 * Age-framed version of health-score.ts's describeHealthScoreTrend — same three-branch
 * shape (steady / improving / gentle dip), same non-alarming voice, translated through
 * computeBiologicalAge instead of the raw score. A rising estimate (older over time)
 * gets the same "nothing to worry about" reassurance health-score.ts already gives a
 * score dip — never fear-based language in either direction, per CLAUDE.md's brand
 * voice rule.
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

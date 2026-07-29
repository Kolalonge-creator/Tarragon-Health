/**
 * I9 small-cell suppression.
 *
 * v3 §13: "any cell derived from fewer than organisations.min_cohort_size
 * individuals renders as 'insufficient data,' never a number. Small-cell
 * suppression is a re-identification control, not a nicety."
 *
 * A single named rule rather than an inline `<` in each loader, so the three
 * places that gate on it cannot drift apart and the edge cases are pinned by
 * tests. Deliberately has no Supabase or React dependency.
 */

/**
 * Hard floor, mirroring `check (min_cohort_size >= 5)` on
 * public.organisations. An organisation may configure 5; it may not configure
 * 1, and it may not switch suppression off.
 */
export const MIN_COHORT_SIZE_FLOOR = 5;

/**
 * Applied when the organisation's threshold cannot be read at all, mirroring
 * the column default. Higher than the floor on purpose — an unknown
 * configuration should be treated more cautiously than a deliberate one.
 */
export const MIN_COHORT_SIZE_FALLBACK = 10;

/**
 * True when a figure derived from `cohortSize` people must be withheld.
 *
 * Cohorts exactly at the threshold are allowed: the threshold is the smallest
 * reportable size, not the first suppressed one.
 */
export function isCohortSuppressed(
  cohortSize: number,
  minCohortSize: number | null | undefined,
): boolean {
  return cohortSize < effectiveMinCohortSize(minCohortSize);
}

/**
 * The threshold actually applied. A missing threshold falls back to the column
 * default; a present but out-of-range one is raised to the floor. Neither ever
 * resolves to 0 — a misconfigured organisation fails closed rather than
 * silently publishing individual-level data.
 */
export function effectiveMinCohortSize(minCohortSize: number | null | undefined): number {
  if (typeof minCohortSize !== "number" || !Number.isFinite(minCohortSize)) {
    return MIN_COHORT_SIZE_FALLBACK;
  }
  return Math.max(Math.trunc(minCohortSize), MIN_COHORT_SIZE_FLOOR);
}

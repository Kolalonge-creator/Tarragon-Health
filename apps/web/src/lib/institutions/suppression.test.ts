import {
  isCohortSuppressed,
  effectiveMinCohortSize,
  MIN_COHORT_SIZE_FLOOR,
  MIN_COHORT_SIZE_FALLBACK,
} from "./suppression";

describe("I9 small-cell suppression", () => {
  it("withholds a cohort smaller than the organisation's threshold", () => {
    expect(isCohortSuppressed(9, 10)).toBe(true);
    expect(isCohortSuppressed(1, 10)).toBe(true);
    expect(isCohortSuppressed(0, 10)).toBe(true);
  });

  it("reports a cohort exactly at the threshold — it is the smallest reportable size", () => {
    expect(isCohortSuppressed(10, 10)).toBe(false);
    expect(isCohortSuppressed(11, 10)).toBe(false);
  });

  it("honours an organisation that deliberately configures the floor", () => {
    expect(effectiveMinCohortSize(MIN_COHORT_SIZE_FLOOR)).toBe(MIN_COHORT_SIZE_FLOOR);
    expect(isCohortSuppressed(5, MIN_COHORT_SIZE_FLOOR)).toBe(false);
    expect(isCohortSuppressed(4, MIN_COHORT_SIZE_FLOOR)).toBe(true);
  });

  it("raises an out-of-range threshold to the floor rather than trusting it", () => {
    for (const bad of [0, 1, 4, -1, -100]) {
      expect(effectiveMinCohortSize(bad)).toBe(MIN_COHORT_SIZE_FLOOR);
    }
    // The important consequence: suppression can never be switched off by
    // writing a zero or negative threshold.
    expect(isCohortSuppressed(1, 0)).toBe(true);
    expect(isCohortSuppressed(1, -50)).toBe(true);
  });

  it("falls back to the column default when the threshold is unreadable", () => {
    for (const missing of [null, undefined, NaN, Infinity]) {
      expect(effectiveMinCohortSize(missing as number)).toBe(MIN_COHORT_SIZE_FALLBACK);
    }
    expect(isCohortSuppressed(9, null)).toBe(true);
    expect(isCohortSuppressed(10, undefined)).toBe(false);
  });

  it("never treats a fractional threshold as a way to shave the floor", () => {
    expect(effectiveMinCohortSize(5.9)).toBe(5);
    expect(effectiveMinCohortSize(4.9)).toBe(MIN_COHORT_SIZE_FLOOR);
    expect(effectiveMinCohortSize(12.7)).toBe(12);
  });

  it("keeps the app floor aligned with the database CHECK", () => {
    // supabase/migrations/…_institutions_aggregate_only_i9.sql declares
    // check (min_cohort_size >= 5). If that changes, this must change with it.
    expect(MIN_COHORT_SIZE_FLOOR).toBe(5);
    expect(MIN_COHORT_SIZE_FALLBACK).toBeGreaterThanOrEqual(MIN_COHORT_SIZE_FLOOR);
  });
});

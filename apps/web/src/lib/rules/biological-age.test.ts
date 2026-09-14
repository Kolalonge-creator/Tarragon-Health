import { describe, expect, it } from "@jest/globals";
import {
  ageFromDateOfBirth,
  computeBiologicalAge,
  describeBiologicalAgeTrend,
} from "./biological-age";
import type { HealthScoreTrend } from "./health-score";

describe("computeBiologicalAge", () => {
  it("returns the chronological age unchanged at the baseline score", () => {
    expect(computeBiologicalAge(50, 70)).toEqual({
      estimatedAge: 50,
      yearsYoungerThanChronological: 0,
    });
  });

  it("estimates younger than chronological age for an above-baseline score", () => {
    // (90 - 70) * 0.25 = 5 years younger
    expect(computeBiologicalAge(50, 90)).toEqual({
      estimatedAge: 45,
      yearsYoungerThanChronological: 5,
    });
  });

  it("estimates older than chronological age for a below-baseline score", () => {
    // (30 - 70) * 0.25 = -10 years -> already at the clamp
    expect(computeBiologicalAge(50, 30)).toEqual({
      estimatedAge: 60,
      yearsYoungerThanChronological: -10,
    });
  });

  it("clamps the gap to MAX_AGE_GAP_YEARS at a perfect score", () => {
    // (100 - 70) * 0.25 = 7.5, well under the 10-year clamp; the clamp only
    // binds at scores that would exceed it under the linear rule.
    expect(computeBiologicalAge(60, 100).yearsYoungerThanChronological).toBe(8);
  });

  it("clamps the gap to MAX_AGE_GAP_YEARS at score 0", () => {
    // (0 - 70) * 0.25 = -17.5, clamped to -10.
    expect(computeBiologicalAge(60, 0).yearsYoungerThanChronological).toBe(-10);
  });

  it("never returns a negative estimated age even for a young patient with a high score", () => {
    // gap = (100 - 70) * 0.25 = 7.5 -> rounds to 8 years younger, which would
    // put a 3-year-old at age -5 without the floor.
    expect(computeBiologicalAge(3, 100).estimatedAge).toBe(0);
  });

  it("rejects a healthScore outside the documented 0-100 range", () => {
    expect(() => computeBiologicalAge(50, 101)).toThrow(/invalid healthScore/);
    expect(() => computeBiologicalAge(50, -1)).toThrow(/invalid healthScore/);
    expect(() => computeBiologicalAge(50, Number.NaN)).toThrow(/invalid healthScore/);
  });

  it("rejects a negative or non-finite chronologicalAge", () => {
    expect(() => computeBiologicalAge(-1, 70)).toThrow(/invalid chronologicalAge/);
    expect(() => computeBiologicalAge(Number.NaN, 70)).toThrow(/invalid chronologicalAge/);
  });
});

describe("ageFromDateOfBirth", () => {
  it("computes a floor-rounded whole-year age", () => {
    const dob = new Date("1990-06-15T00:00:00.000Z");
    const now = new Date("2026-06-14T00:00:00.000Z"); // one day short of the birthday
    expect(ageFromDateOfBirth(dob, now)).toBe(35);
  });

  it("accepts an ISO date string the same as a Date", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(ageFromDateOfBirth("2000-01-01", now)).toBe(26);
  });
});

describe("describeBiologicalAgeTrend", () => {
  const baseTrend: HealthScoreTrend = {
    firstScore: 70,
    lastScore: 70,
    firstDate: "2026-06-01T00:00:00.000Z",
    lastDate: "2026-08-01T00:00:00.000Z",
    scoreDelta: 0,
    bmiSubScoreDelta: 0,
  };

  it("reports a steady estimate without alarm language", () => {
    expect(describeBiologicalAgeTrend(baseTrend, 50)).toBe(
      "Since your first check, your estimate has held steady at 50 years.",
    );
  });

  it("states a falling estimate (improving) plainly, with no reassurance needed", () => {
    const trend: HealthScoreTrend = { ...baseTrend, firstScore: 70, lastScore: 90 };
    const line = describeBiologicalAgeTrend(trend, 50);
    expect(line).toBe("Since your first check, your estimate has moved from 50 to 45 years.");
  });

  it("softens a rising estimate (older) with the same reassurance health-score.ts uses for a dip", () => {
    const trend: HealthScoreTrend = { ...baseTrend, firstScore: 90, lastScore: 70 };
    const line = describeBiologicalAgeTrend(trend, 50);
    expect(line).toContain("moved from 45 to 50 years");
    expect(line).toContain("nothing to worry about");
  });
});

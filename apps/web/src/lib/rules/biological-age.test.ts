import { describe, expect, it } from "@jest/globals";
import {
  computeBiologicalAge,
  ageFromDateOfBirth,
  describeBiologicalAgeTrend,
} from "./biological-age";
import type { HealthScoreTrend } from "./health-score";

describe("computeBiologicalAge", () => {
  it("returns no gap at the baseline score", () => {
    const result = computeBiologicalAge(45, 70);
    expect(result.estimatedAge).toBe(45);
    expect(result.yearsYoungerThanChronological).toBe(0);
  });

  it("estimates younger than chronological age for a score above baseline", () => {
    const result = computeBiologicalAge(37, 81);
    expect(result.yearsYoungerThanChronological).toBeGreaterThan(0);
    expect(result.estimatedAge).toBeLessThan(37);
  });

  it("estimates older than chronological age for a score below baseline", () => {
    const result = computeBiologicalAge(45, 46);
    expect(result.yearsYoungerThanChronological).toBeLessThan(0);
    expect(result.estimatedAge).toBeGreaterThan(45);
  });

  it("clamps the age gap so a very low score never reads as alarmingly old", () => {
    const result = computeBiologicalAge(45, 0);
    expect(result.yearsYoungerThanChronological).toBe(-10);
    expect(result.estimatedAge).toBe(55);
  });

  it("never returns a negative estimated age", () => {
    const result = computeBiologicalAge(5, 100);
    expect(result.estimatedAge).toBe(0);
  });
});

describe("ageFromDateOfBirth", () => {
  it("computes whole years relative to the given reference date", () => {
    const now = new Date("2026-08-26T00:00:00Z");
    expect(ageFromDateOfBirth("1989-01-15T00:00:00Z", now)).toBe(37);
    expect(ageFromDateOfBirth("2026-08-25T00:00:00Z", now)).toBe(0);
  });
});

describe("describeBiologicalAgeTrend", () => {
  const trend = (firstScore: number, lastScore: number): HealthScoreTrend => ({
    firstScore,
    lastScore,
    firstDate: "2026-03-01T00:00:00Z",
    lastDate: "2026-08-01T00:00:00Z",
    scoreDelta: lastScore - firstScore,
    bmiSubScoreDelta: null,
  });

  it("states an improving estimate plainly, without fear-based language", () => {
    const line = describeBiologicalAgeTrend(trend(70, 82), 37);
    expect(line).toMatch(/moved from \d+ to \d+ years/);
    expect(line.toLowerCase()).not.toContain("warning");
    expect(line.toLowerCase()).not.toContain("nothing to worry");
  });

  it("describes a worsening estimate gently, matching health-score.ts's own dip voice", () => {
    const line = describeBiologicalAgeTrend(trend(82, 70), 37);
    expect(line).toMatch(/moved from \d+ to \d+ years/);
    expect(line.toLowerCase()).toContain("nothing to worry about");
    expect(line.toLowerCase()).not.toContain("warning");
    expect(line.toLowerCase()).not.toContain("fail");
  });

  it("reports a steady estimate as held steady, never fabricating movement", () => {
    const line = describeBiologicalAgeTrend(trend(75, 75), 40);
    expect(line).toMatch(/held steady at \d+ years/);
  });
});

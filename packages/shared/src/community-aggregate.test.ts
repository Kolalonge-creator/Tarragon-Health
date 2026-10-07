import { describe, expect, it } from "@jest/globals";
import { aggregateChallenge } from "./community-aggregate";
import { getProposedConfig } from "./proposed-config";

const rules = getProposedConfig("community.rules").value as {
  min_contributors: number; max_single_share_pct: number; round_total_to: number; progress_step_pct: number;
};

describe("aggregateChallenge (reference model of the SQL, same cases as the database proof)", () => {
  it("cohort A: 12 contributors, 1813 of a 1800 goal: shown, rounded to 1810, goal reached", () => {
    const r = aggregateChallenge([163, ...Array<number>(11).fill(150)], 150, rules);
    expect(r).toEqual({ suppressed: false, totalRounded: 1810, progressPct: 100, goalReached: true, contributorBand: "10-19" });
  });

  it("the floor is 10: nine contributors are hidden, ten are shown", () => {
    expect(aggregateChallenge(Array<number>(9).fill(30), 150, rules)).toEqual({ suppressed: true, reason: "too_few" });
    expect(aggregateChallenge(Array<number>(10).fill(30), 150, rules).suppressed).toBe(false);
  });

  it("the floor is not the institutional floor of 5", () => {
    expect(aggregateChallenge(Array<number>(5).fill(30), 150, rules)).toEqual({ suppressed: true, reason: "too_few" });
  });

  it("leave-one-out: one dominant contributor hides the total; an even spread shows it", () => {
    expect(aggregateChallenge([180, ...Array<number>(10).fill(10)], 150, rules)).toEqual({ suppressed: true, reason: "dominant_contributor" });
    expect(aggregateChallenge([180, ...Array<number>(10).fill(80)], 150, rules).suppressed).toBe(false);
  });

  it("people who did nothing are not counted as contributors (so a count of zero effort is never revealed)", () => {
    expect(aggregateChallenge([...Array<number>(9).fill(30), 0, 0, 0], 150, rules)).toEqual({ suppressed: true, reason: "too_few" });
  });

  it("the result has no member id and no per-member figure", () => {
    const r = aggregateChallenge([163, ...Array<number>(11).fill(150)], 150, rules);
    expect(Object.keys(r).sort()).toEqual(["contributorBand", "goalReached", "progressPct", "suppressed", "totalRounded"]);
    expect(JSON.stringify(r)).not.toContain("163");
  });

  it("progress is floored to the step, never rounded up to look better", () => {
    // 10 members at 75 of a 150 target is exactly 50 percent
    expect(aggregateChallenge(Array<number>(10).fill(75), 150, rules)).toMatchObject({ progressPct: 50, goalReached: false });
    // 12.9 percent floors to 10
    expect(aggregateChallenge(Array<number>(10).fill(19), 150, rules)).toMatchObject({ progressPct: 10 });
  });
});

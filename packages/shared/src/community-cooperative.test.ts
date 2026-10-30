import { describe, expect, it } from "@jest/globals";
import { aggregateChallenge } from "./community-aggregate";
import {
  capDailyContribution, findShameCopy, restCheckinValue, sharedGoalPath, toEventDay, weekStart, weeksActive, type CooperativeRules,
} from "./community-cooperative";
import { getProposedConfig } from "./proposed-config";

const coop = getProposedConfig("cohorts.cooperative").value as CooperativeRules;
const agg = getProposedConfig("cohorts.rules").value as { min_contributors: number; max_single_share_pct: number; round_total_to: number; progress_step_pct: number };

describe("shared goal path (drawn from the suppressed aggregate only)", () => {
  it("a cohort of 9 shows nothing: the aggregate is suppressed, so the path has no step reached", () => {
    const r = aggregateChallenge(Array<number>(9).fill(30), 150, agg);
    expect(r.suppressed).toBe(true);
    const p = sharedGoalPath(r.suppressed ? null : r.progressPct, coop.path_milestones);
    expect(p.reachedCount).toBe(0);
    expect(p.complete).toBe(false);
  });

  it("a cohort of 10 shows only the total and the band, never a member's figure", () => {
    const r = aggregateChallenge([...Array<number>(9).fill(30), 41], 150, agg);
    expect(r.suppressed).toBe(false);
    if (r.suppressed) return;
    expect(Object.keys(r).sort()).toEqual(["contributorBand", "goalReached", "progressPct", "suppressed", "totalRounded"]);
    expect(r.contributorBand).toBe("10-19");
    const p = sharedGoalPath(r.progressPct, coop.path_milestones);
    expect(p.total).toBe(coop.path_milestones);
    expect(JSON.stringify(p)).not.toMatch(/41/);
  });

  it("a dominant contributor hides the total, so the path stays empty", () => {
    const r = aggregateChallenge([180, ...Array<number>(10).fill(10)], 150, agg);
    expect(r).toEqual({ suppressed: true, reason: "dominant_contributor" });
    expect(sharedGoalPath(null, 5).reachedCount).toBe(0);
  });

  it("steps fill monotonically with progress and the goal completes the path", () => {
    expect(sharedGoalPath(0, 5).reachedCount).toBe(0);
    expect(sharedGoalPath(45, 5).reachedCount).toBe(2);
    expect(sharedGoalPath(45, 5).steps.filter((s) => s.current)).toHaveLength(1);
    expect(sharedGoalPath(100, 5)).toMatchObject({ reachedCount: 5, complete: true });
    expect(sharedGoalPath(140, 5).reachedCount).toBe(5);
  });
});

describe("weeks active (cumulative, never resets, no shame)", () => {
  it("counts calendar weeks with any effort, and adding a day never lowers it", () => {
    const days = ["2026-10-19", "2026-10-21", "2026-10-28"]; // 19 and 21 share a week
    expect(weeksActive(days)).toBe(2);
    expect(weeksActive([...days, "2026-12-01"])).toBeGreaterThanOrEqual(weeksActive(days));
  });

  it("a gap of weeks does not reduce the count (no streak to break)", () => {
    expect(weeksActive(["2026-10-05", "2026-11-23"])).toBe(2);
  });

  it("weeks start on Monday, like the database", () => {
    expect(weekStart("2026-10-22")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
  });
});

describe("daily cap, rest check-in and day-level events", () => {
  it("caps one person's day by unit, from configuration", () => {
    expect(capDailyContribution(5, "days", coop)).toBe(coop.daily_cap_days);
    expect(capDailyContribution(9, "lessons", coop)).toBe(coop.daily_cap_lessons);
    expect(capDailyContribution(999, "minutes", coop)).toBe(coop.daily_cap_minutes);
    expect(capDailyContribution(-4, "minutes", coop)).toBe(0);
  });

  it("a rest check-in counts the same as a day of effort, within the cap", () => {
    expect(restCheckinValue("days", coop)).toBe(capDailyContribution(1, "days", coop));
    expect(restCheckinValue("lessons", coop)).toBe(1);
    expect(restCheckinValue("minutes", coop)).toBeLessThanOrEqual(coop.daily_cap_minutes);
  });

  it("keeps only the calendar day in Africa/Lagos, never the time of day", () => {
    expect(toEventDay("2026-10-22T23:30:00Z")).toBe("2026-10-23");
    expect(toEventDay("2026-10-22T10:05:00Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("shame copy lint", () => {
  it("catches shame phrases", () => {
    expect(findShameCopy("You fell behind this week")).toContain("fell behind");
    expect(findShameCopy("Your streak was reset to zero")).toContain("reset to zero");
    expect(findShameCopy("Do not let the group down")).toContain("let the group down");
  });
  it("accepts warm, cooperative wording", () => {
    expect(findShameCopy("Welcome back. Every week you take part counts, and rest counts too.")).toEqual([]);
  });
});

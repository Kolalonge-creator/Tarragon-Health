import { describe, expect, it } from "@jest/globals";
import { evaluateStreak } from "@tarragon/lifestyle-engine";
import {
  buildDailyOutcomeSeries,
  sortGoalsByPriority,
  getPriorityWeeklyGoal,
  type WeeklyPlanGoal,
} from "./weekly-plan";

describe("buildDailyOutcomeSeries", () => {
  it("marks today done when today's Lagos date key was logged", () => {
    // 10:00 UTC on 2026-08-20 is 11:00 Lagos, same Lagos calendar day.
    const today = new Date("2026-08-20T10:00:00.000Z");
    const series = buildDailyOutcomeSeries(new Set(["2026-08-20"]), today, 3);
    expect(series).toEqual(["done", "missed", "missed"]);
  });

  it("orders most-recent-first, matching evaluateStreak's expected input", () => {
    const today = new Date("2026-08-20T10:00:00.000Z");
    const series = buildDailyOutcomeSeries(
      new Set(["2026-08-20", "2026-08-19", "2026-08-17"]),
      today,
      4
    );
    expect(series).toEqual(["done", "done", "missed", "done"]);
  });

  it("feeds evaluateStreak correctly: a run of logged days yields a matching streak", () => {
    const today = new Date("2026-08-20T10:00:00.000Z");
    const series = buildDailyOutcomeSeries(
      new Set(["2026-08-20", "2026-08-19", "2026-08-18"]),
      today,
      5
    );
    const streak = evaluateStreak(series);
    expect(streak.currentStreak).toBe(3);
    expect(streak.shouldNudge).toBe(false);
  });

  it("a gap after today's streak still nudges via evaluateStreak, per the kind-streak rule", () => {
    const today = new Date("2026-08-20T10:00:00.000Z");
    // Logged today, missed yesterday.
    const series = buildDailyOutcomeSeries(new Set(["2026-08-20"]), today, 3);
    const streak = evaluateStreak(series);
    expect(streak.currentStreak).toBe(1);
    expect(streak.recentMisses).toBe(0); // the miss is behind the done day, not "recent"
  });

  it("handles an empty logged set as all-missed", () => {
    const today = new Date("2026-08-20T10:00:00.000Z");
    const series = buildDailyOutcomeSeries(new Set(), today, 3);
    expect(series).toEqual(["missed", "missed", "missed"]);
    expect(evaluateStreak(series).currentStreak).toBe(0);
  });
});

function goal(overrides: Partial<WeeklyPlanGoal> & { id: string }): WeeklyPlanGoal {
  return {
    organisationId: "org-1",
    enrollmentId: "enr-1",
    module: "activity",
    title: overrides.id,
    measurementType: "activity_minutes",
    cadence: "daily",
    doneToday: false,
    doneThisWeek: false,
    streak: evaluateStreak([]),
    last14Days: [],
    ...overrides,
  };
}

describe("sortGoalsByPriority", () => {
  it("puts a goal needing worklist attention ahead of a merely-nudged one", () => {
    const onTrack = goal({ id: "on-track", doneToday: true, streak: evaluateStreak(["done"]) });
    const nudged = goal({
      id: "nudged",
      streak: evaluateStreak(["missed", "done", "done"]),
    });
    const atRisk = goal({
      id: "at-risk",
      streak: evaluateStreak(["missed", "missed", "missed", "done"]),
    });
    const sorted = sortGoalsByPriority([onTrack, nudged, atRisk]);
    expect(sorted.map((g) => g.id)).toEqual(["at-risk", "nudged", "on-track"]);
  });

  it("keeps original order stable within the same priority tier", () => {
    const a = goal({ id: "a" });
    const b = goal({ id: "b" });
    expect(sortGoalsByPriority([a, b]).map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("ranks an outstanding weekly-cadence goal above one already done this week", () => {
    const outstandingWeekly = goal({ id: "weekly-todo", cadence: "weekly", doneThisWeek: false });
    const doneWeekly = goal({ id: "weekly-done", cadence: "weekly", doneThisWeek: true });
    expect(sortGoalsByPriority([doneWeekly, outstandingWeekly]).map((g) => g.id)).toEqual([
      "weekly-todo",
      "weekly-done",
    ]);
  });
});

describe("getPriorityWeeklyGoal", () => {
  it("returns null when every goal is already satisfied", () => {
    const goals = [
      goal({ id: "a", doneToday: true }),
      goal({ id: "b", cadence: "weekly", doneThisWeek: true }),
    ];
    expect(getPriorityWeeklyGoal(goals)).toBeNull();
  });

  it("returns the single most-urgent outstanding goal", () => {
    const nudged = goal({ id: "nudged", streak: evaluateStreak(["missed", "done"]) });
    const atRisk = goal({
      id: "at-risk",
      streak: evaluateStreak(["missed", "missed", "missed"]),
    });
    expect(getPriorityWeeklyGoal([nudged, atRisk])?.id).toBe("at-risk");
  });
});

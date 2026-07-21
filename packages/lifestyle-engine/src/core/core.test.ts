import { describe, it, expect } from "@jest/globals";
import { buildInstantiationPlan, nextPhase, evaluateStreak } from "./index";
import type { PhaseTemplateNode } from "./index";

const phases: PhaseTemplateNode[] = [
  { id: "p1", key: "foundation", orderIndex: 0, kind: "foundation",
    durationDaysMin: 14, durationDaysMax: 28, autoAdvance: false,
    goals: [{ id: "g1", module: "diet", title: "Cut salt", metricKey: null, target: null }] },
  { id: "p2", key: "build", orderIndex: 1, kind: "build",
    durationDaysMin: 28, durationDaysMax: 56, autoAdvance: false, goals: [] },
  { id: "p3", key: "maintenance", orderIndex: 2, kind: "maintenance",
    durationDaysMin: null, durationDaysMax: null, autoAdvance: false, goals: [] },
];

describe("buildInstantiationPlan", () => {
  it("starts only the first phase active with a target end date", () => {
    const plan = buildInstantiationPlan({ phases, startedAt: "2026-07-19T00:00:00.000Z" });
    expect(plan.currentPhaseKey).toBe("foundation");
    expect(plan.phases[0]?.status).toBe("active");
    expect(plan.phases[0]?.targetEndAt).toBe("2026-08-16T00:00:00.000Z"); // +28d
    expect(plan.phases[1]?.status).toBe("pending");
    expect(plan.firstPhaseGoals).toHaveLength(1);
    expect(plan.firstPhaseGoals[0]?.title).toBe("Cut salt");
  });

  it("handles unordered input by sorting on orderIndex", () => {
    const shuffled = [phases[2]!, phases[0]!, phases[1]!];
    const plan = buildInstantiationPlan({ phases: shuffled, startedAt: "2026-07-19T00:00:00.000Z" });
    expect(plan.currentPhaseKey).toBe("foundation");
  });
});

describe("nextPhase", () => {
  it("returns the following phase", () => {
    expect(nextPhase(phases, "foundation")?.key).toBe("build");
  });
  it("returns null at the last phase", () => {
    expect(nextPhase(phases, "maintenance")).toBeNull();
  });
});

describe("evaluateStreak (kind — a miss is never a failure)", () => {
  it("counts a completion streak", () => {
    const r = evaluateStreak(["done", "done", "done", "missed"]);
    expect(r.currentStreak).toBe(3);
    expect(r.shouldNudge).toBe(false);
  });

  it("nudges gently after a recent miss, never a worklist item yet", () => {
    const r = evaluateStreak(["missed", "done", "done"]);
    expect(r.recentMisses).toBe(1);
    expect(r.shouldNudge).toBe(true);
    expect(r.shouldRaiseWorklistItem).toBe(false);
  });

  it("raises a supportive worklist item only after the miss threshold", () => {
    const r = evaluateStreak(["missed", "missed", "missed", "done"]);
    expect(r.recentMisses).toBe(3);
    expect(r.shouldRaiseWorklistItem).toBe(true);
  });

  it("treats skipped as neutral (does not break a streak)", () => {
    const r = evaluateStreak(["done", "skipped", "done"]);
    expect(r.currentStreak).toBe(2);
  });
});

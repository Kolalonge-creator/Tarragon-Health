import { describe, expect, it } from "@jest/globals";
import { confidenceDots, cycleStatus } from "./status";
import { addDays, predictCycle } from "./prediction";

const today = "2026-10-10";
const run = (starts: number[]) =>
  predictCycle({
    periods: starts.map((n) => ({ startDate: addDays(today, n), endDate: addDays(today, n + 4) })),
    today,
    lifeStage: "menstruating",
    selfReportedCycleLengthDays: null,
    heavyFlowDates: [],
    conceptionPlanning: false,
  });

describe("cycleStatus", () => {
  it("is grey with no history", () => {
    expect(cycleStatus(run([]))).toEqual({ kind: "no_history", days: null, tone: "grey" });
  });

  it("counts down to the expected period in the brand tone", () => {
    const s = cycleStatus(run([-97, -69, -41, -13]));
    expect(s.kind).toBe("in_days");
    expect(s.tone).toBe("brand");
    expect(s.days).toBeGreaterThan(0);
  });

  it("is amber, never red, once the period is later than the estimate", () => {
    const s = cycleStatus(run([-120, -92, -64, -36]));
    expect(s.kind).toBe("overdue");
    expect(s.tone).toBe("amber");
  });

  it("has no tone that could mean danger", () => {
    for (const p of [[], [-97, -69, -41, -13], [-120, -92, -64, -36], [-28]]) {
      expect(["brand", "amber", "grey"]).toContain(cycleStatus(run(p)).tone);
    }
  });
});

describe("a period in progress", () => {
  it("says it started N days ago and shows no countdown", () => {
    const p = run([-97, -69, -41, -2]);
    expect(cycleStatus(p, { startedOn: addDays(today, -2), today })).toEqual({ kind: "in_progress", days: 2, tone: "brand" });
    expect(cycleStatus(p, { startedOn: today, today })).toEqual({ kind: "in_progress", days: 0, tone: "brand" });
  });
  it("without one in progress the countdown still shows", () => {
    expect(cycleStatus(run([-97, -69, -41, -13])).kind).toBe("in_days");
  });
});

describe("confidenceDots", () => {
  it("maps the engine's own level to 0 to 3 dots and never shows more than it has", () => {
    expect(confidenceDots("none")).toBe(0);
    expect(confidenceDots("low")).toBe(1);
    expect(confidenceDots("medium")).toBe(2);
    expect(confidenceDots("high")).toBe(3);
  });
});

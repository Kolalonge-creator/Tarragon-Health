import { describe, expect, it } from "@jest/globals";
import { buildCyclePatternReport, PATTERN_REPORT_STATEMENT, type PatternLogDay } from "./pattern-report";

const periods = [
  { startDate: "2026-05-01", endDate: "2026-05-05" },
  { startDate: "2026-05-29", endDate: "2026-06-02" },
  { startDate: "2026-07-03", endDate: null },
  { startDate: "2026-07-31", endDate: "2026-08-06" },
];
const logs: PatternLogDay[] = [
  { date: "2026-07-31", flow: "heavy", symptoms: ["cramps", "fatigue"], moods: ["low"] },
  { date: "2026-08-01", flow: "flooding", symptoms: ["cramps"], moods: [] },
  { date: "2026-08-02", flow: "medium", symptoms: ["cramps", "headache"], moods: ["irritable"] },
  { date: "2026-08-03", flow: "spotting", symptoms: [], moods: [] },
];

describe("buildCyclePatternReport", () => {
  const r = buildCyclePatternReport({ periods, logs, today: "2026-09-01", lifeStage: "menstruating", windowMonths: 6 });

  it("derives lengths from consecutive starts and leaves the latest period open", () => {
    expect(r.cycles.map((c) => c.lengthDays)).toEqual([28, 35, 28, null]);
    expect(r.cycles[2]?.durationDays).toBeNull();
    expect(r.cycles[3]?.durationDays).toBe(7);
  });

  it("states variability as logged", () => {
    expect(r.length).toMatchObject({ count: 3, minDays: 28, maxDays: 35, rangeDays: 7, meanDays: 30.3, sdDays: 4 });
    expect(r.length.outsideUsualRangeCount).toBe(0);
  });

  it("counts flow and ranks symptoms by days", () => {
    expect(r.flow).toMatchObject({ loggedDays: 4, heavyOrFloodingDays: 2, spottingDays: 1 });
    expect(r.symptoms[0]).toEqual({ name: "cramps", days: 3, percentOfLoggedDays: 75 });
    expect(r.moods.map((m) => m.name).sort()).toEqual(["irritable", "low"]);
  });

  it("carries no fertility figure of any kind and says so", () => {
    const text = JSON.stringify(r).toLowerCase();
    for (const word of ["fertile", "ovulation", "temperature"]) expect(text.includes(word)).toBe(false);
    expect(r.statement).toBe(PATTERN_REPORT_STATEMENT);
    expect(PATTERN_REPORT_STATEMENT).toContain("No fertility estimate is included");
  });

  it("raises the heavy bleeding prompt from the same engine", () => {
    const heavy = buildCyclePatternReport({ periods, logs: [...logs, { date: "2026-08-04", flow: "flooding", symptoms: [], moods: [] }, { date: "2026-08-05", flow: "flooding", symptoms: [], moods: [] }], today: "2026-09-01", lifeStage: "menstruating", windowMonths: 6 });
    expect(heavy.flags.length).toBeGreaterThanOrEqual(r.flags.length);
  });

  it("ignores rows outside the window and an empty history is not a crash", () => {
    const old = buildCyclePatternReport({ periods, logs, today: "2026-09-01", lifeStage: "menstruating", windowMonths: 2 });
    expect(old.cycles.map((c) => c.startDate)).toEqual(["2026-07-03", "2026-07-31"]);
    const none = buildCyclePatternReport({ periods: [], logs: [], today: "2026-09-01", lifeStage: "menstruating", windowMonths: 6 });
    expect(none.length.meanDays).toBeNull();
    expect(none.loggedDays).toBe(0);
  });
});

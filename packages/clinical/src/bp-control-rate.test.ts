import { describe, expect, it } from "@jest/globals";
import { computeBpControlRate, type ControlReading } from "./bp-control-rate";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 86_400_000;
const GATE = [
  { minReadings: 3, minDays: 3, minPerDay: 1 },
  { minReadings: 4, minDays: 2, minPerDay: 2 },
];
const TARGET = { systolicBelow: 135, diastolicBelow: 85 };
const at = (daysAgo: number, minutes = 0) => NOW - daysAgo * DAY + minutes * 60_000;
const r = (sys: number, dia: number, atMs: number): ControlReading => ({ systolic: sys, diastolic: dia, atMs });
const run = (readings: ControlReading[], over: Partial<Parameters<typeof computeBpControlRate>[0]> = {}) =>
  computeBpControlRate({ readings, target: TARGET, gateRules: GATE, nowMs: NOW, periodDays: 30, minGapMinutes: 1, ...over });

describe("computeBpControlRate", () => {
  it("shows no rate and no average below the gate, only how many were counted", () => {
    const out = run([r(150, 95, at(1)), r(120, 80, at(2))]);
    expect(out).toMatchObject({ gateMet: false, counted: 2, percentInTarget: null, inTarget: null, meanSystolic: null, meanDiastolic: null });
  });

  it("past the gate, reports the share in target and the mean", () => {
    const out = run([r(120, 80, at(1)), r(130, 82, at(2)), r(150, 95, at(3)), r(128, 79, at(4))]);
    expect(out).toMatchObject({ gateMet: true, counted: 4, inTarget: 3, percentInTarget: 75, meanSystolic: 132, meanDiastolic: 84 });
  });

  it("needs BOTH numbers under the limits, and the limit itself is not in target", () => {
    const out = run([r(134, 85, at(1)), r(135, 70, at(2)), r(134, 84, at(3))]);
    expect(out.inTarget).toBe(1);
  });

  it("the second rule can open the gate (4 readings, 2 per day on 2 days)", () => {
    const out = run([r(120, 80, at(1)), r(121, 80, at(1, 30)), r(122, 80, at(2)), r(123, 80, at(2, 30))]);
    expect(out.gateMet).toBe(true);
  });

  it("does not count a second reading inside the minimum gap (the same measurement saved twice)", () => {
    const out = run([r(120, 80, at(1)), r(120, 80, at(1, 0.5)), r(121, 80, at(2)), r(122, 80, at(3))]);
    expect(out.counted).toBe(3);
  });

  it("ignores readings outside the period and readings that are not numbers", () => {
    const out = run([r(120, 80, at(40)), r(NaN, 80, at(1)), r(120, 80, at(1)), r(121, 80, at(2)), r(122, 80, at(3))]);
    expect(out.counted).toBe(3);
  });

  it("buckets by Lagos day, not UTC day (23:30 UTC is already the next Lagos day)", () => {
    const lateUtc = Date.parse("2026-10-18T23:30:00Z");
    const early = Date.parse("2026-10-19T00:10:00Z");
    expect(run([r(120, 80, lateUtc), r(121, 80, early), r(122, 80, at(5))]).days).toBe(2);
  });

  it("with no readings at all, is simply not met", () => {
    expect(run([])).toMatchObject({ gateMet: false, counted: 0, percentInTarget: null });
  });
});

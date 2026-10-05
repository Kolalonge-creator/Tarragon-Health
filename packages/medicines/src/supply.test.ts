import { describe, expect, it } from "@jest/globals";
import { estimateSupply, isRunningLow, validatePillCount, type SupplyInput } from "./supply";
import type { ScheduleSpec } from "./types";

const base = { startDate: null, endDate: null, foodNote: null } as const;
const daily2: ScheduleSpec = { ...base, kind: "daily", times: ["08:00", "20:00"] };
const now = Date.parse("2026-10-05T05:00:00Z"); // 06:00 Lagos, before the first dose

function input(over: Partial<SupplyInput>): SupplyInput {
  return { pillsOnHand: 10, countedAtMs: now, pillsPerDose: 1, spec: daily2, dosesTakenSinceCount: 0, nowMs: now, ...over };
}

describe("estimateSupply", () => {
  it("finds the run-out date and whole days left", () => {
    const e = estimateSupply(input({}));
    // 10 pills, 2 a day: the 11th dose (day 6 morning) has no pill
    expect(e).toMatchObject({ pillsLeft: 10, daysLeft: 5, runOutDate: "2026-10-10", coversCourse: false });
  });
  it("subtracts doses already taken since the count", () => {
    expect(estimateSupply(input({ dosesTakenSinceCount: 4 }))).toMatchObject({ pillsLeft: 6, runOutDate: "2026-10-08", daysLeft: 3 });
  });
  it("never goes below zero and reports today when already out", () => {
    expect(estimateSupply(input({ pillsOnHand: 2, dosesTakenSinceCount: 5 }))).toMatchObject({ pillsLeft: 0, daysLeft: 0, runOutDate: "2026-10-05" });
  });
  it("uses pills per dose, including halves, and falls back to 1 for a bad value", () => {
    expect(estimateSupply(input({ pillsOnHand: 5, pillsPerDose: 0.5 })).runOutDate).toBe("2026-10-10");
    expect(estimateSupply(input({ pillsOnHand: 4, pillsPerDose: 0 })).runOutDate).toBe("2026-10-07");
  });
  it("does not count a past slot, or one already answered, against the supply", () => {
    const later = Date.parse("2026-10-05T10:00:00Z"); // 11:00 Lagos, 08:00 dose is past
    expect(estimateSupply(input({ nowMs: later, pillsOnHand: 1 })).runOutDate).toBe("2026-10-06");
    const answered = new Set(["2026-10-05|08:00"]);
    expect(estimateSupply(input({ pillsOnHand: 1, answeredSlots: answered })).runOutDate).toBe("2026-10-06");
  });
  it("says the supply covers a course that ends inside the horizon", () => {
    const short: ScheduleSpec = { ...daily2, endDate: "2026-10-08" };
    expect(estimateSupply(input({ spec: short, pillsOnHand: 20 }))).toMatchObject({ coversCourse: true, daysLeft: null, runOutDate: null });
  });
  it("has no run-out for an ongoing schedule with enough pills for the whole horizon", () => {
    expect(estimateSupply(input({ pillsOnHand: 5000 }))).toMatchObject({ coversCourse: false, daysLeft: null, runOutDate: null });
  });
  it("has nothing to count for an as-needed medicine", () => {
    const prn: ScheduleSpec = { ...base, kind: "as_needed", maxPerDay: 2 };
    expect(estimateSupply(input({ spec: prn }))).toMatchObject({ daysLeft: null, coversCourse: false });
  });
  it("crosses a month and a leap day", () => {
    const e = estimateSupply(input({ nowMs: Date.parse("2028-02-27T05:00:00Z"), pillsOnHand: 4 }));
    expect(e.runOutDate).toBe("2028-02-29");
  });
});

describe("isRunningLow", () => {
  it("is low only with a known run-out inside the lead days", () => {
    expect(isRunningLow({ pillsLeft: 3, daysLeft: 7, runOutDate: "x", coversCourse: false }, 7)).toBe(true);
    expect(isRunningLow({ pillsLeft: 30, daysLeft: 8, runOutDate: "x", coversCourse: false }, 7)).toBe(false);
    expect(isRunningLow({ pillsLeft: 30, daysLeft: null, runOutDate: null, coversCourse: true }, 7)).toBe(false);
  });
});

describe("validatePillCount", () => {
  it("accepts whole and half counts", () => {
    expect(validatePillCount(0)).toEqual({ ok: true, value: 0 });
    expect(validatePillCount(12.5)).toEqual({ ok: true, value: 12.5 });
  });
  it("refuses everything else", () => {
    expect(validatePillCount("12")).toEqual({ ok: false, reason: "not_a_number" });
    expect(validatePillCount(NaN)).toEqual({ ok: false, reason: "not_a_number" });
    expect(validatePillCount(-1)).toEqual({ ok: false, reason: "negative" });
    expect(validatePillCount(10001)).toEqual({ ok: false, reason: "too_large" });
    expect(validatePillCount(1.3)).toEqual({ ok: false, reason: "not_half_units" });
  });
});

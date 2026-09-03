import { describe, expect, it } from "@jest/globals";
import { computeGestationalEstimate } from "./gestational-age";

describe("computeGestationalEstimate", () => {
  it("estimates weeks from LMP as of a given date", () => {
    const estimate = computeGestationalEstimate({
      lastMenstrualPeriodDate: "2026-01-01",
      estimatedDueDate: null,
      asOfDate: "2026-03-26", // 84 days later = 12 completed weeks
    });
    expect(estimate?.weeks).toBe(12);
    expect(estimate?.source).toBe("lmp");
  });

  it("derives an estimated due date 280 days after the LMP", () => {
    const estimate = computeGestationalEstimate({
      lastMenstrualPeriodDate: "2026-01-01",
      estimatedDueDate: null,
      asOfDate: "2026-01-01",
    });
    expect(estimate?.estimatedDueDate).toBe("2026-10-08");
    expect(estimate?.weeks).toBe(0);
  });

  it("falls back to the estimated due date when no LMP is on file", () => {
    const estimate = computeGestationalEstimate({
      lastMenstrualPeriodDate: null,
      estimatedDueDate: "2026-10-08",
      asOfDate: "2026-03-26",
    });
    expect(estimate?.source).toBe("due_date");
    expect(estimate?.weeks).toBe(12);
  });

  it("prefers LMP over an also-present due date", () => {
    const estimate = computeGestationalEstimate({
      lastMenstrualPeriodDate: "2026-01-01",
      estimatedDueDate: "2026-11-01", // deliberately inconsistent with LMP
      asOfDate: "2026-01-01",
    });
    expect(estimate?.source).toBe("lmp");
  });

  it("returns null when neither LMP nor due date is on file", () => {
    expect(
      computeGestationalEstimate({ lastMenstrualPeriodDate: null, estimatedDueDate: null, asOfDate: "2026-01-01" })
    ).toBeNull();
  });

  it("clamps weeks to a plausible range rather than going negative or unbounded", () => {
    const future = computeGestationalEstimate({
      lastMenstrualPeriodDate: "2026-06-01",
      estimatedDueDate: null,
      asOfDate: "2026-01-01", // "as of" before the LMP -- should clamp to 0, not negative
    });
    expect(future?.weeks).toBe(0);
  });
});

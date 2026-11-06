import { describe, expect, it } from "@jest/globals";
import { daysLabel, daysUntil, isDueNow, isOverdue, SCREENING_GRACE_DAYS } from "./due-label";

const now = new Date("2026-11-03T10:00:00+01:00");

describe("due-label", () => {
  it("counts whole days across day boundaries", () => {
    expect(daysUntil("2026-11-03", now)).toBe(0);
    expect(daysUntil("2026-11-08", now)).toBe(5);
    expect(daysUntil("2026-10-30", now)).toBe(-4);
  });

  it("reads a screening scheduled four days ago as due now, not overdue", () => {
    expect(daysLabel("2026-10-30", SCREENING_GRACE_DAYS, now)).toBe("due now");
    expect(isDueNow("2026-10-30", SCREENING_GRACE_DAYS, now)).toBe(true);
    expect(isOverdue("2026-10-30", SCREENING_GRACE_DAYS, now)).toBe(false);
  });

  it("becomes overdue once the grace window has passed", () => {
    expect(daysLabel("2026-09-20", SCREENING_GRACE_DAYS, now)).toBe("44 days overdue");
    expect(isOverdue("2026-09-20", SCREENING_GRACE_DAYS, now)).toBe(true);
    expect(isDueNow("2026-09-20", SCREENING_GRACE_DAYS, now)).toBe(false);
  });

  it("keeps the exact wording for items with no grace", () => {
    expect(daysLabel("2026-10-30", 0, now)).toBe("4 days overdue");
    expect(daysLabel("2026-11-02", 0, now)).toBe("1 day overdue");
    expect(daysLabel("2026-11-03", 0, now)).toBe("today");
    expect(daysLabel("2026-11-04", 0, now)).toBe("in 1 day");
    expect(isOverdue("2026-11-02", 0, now)).toBe(true);
  });
});

describe("daysUntil uses the Lagos calendar (regression)", () => {
  it("counts a due date as today at 00:30 in Lagos, when UTC is still the day before", () => {
    // 2026-11-09T23:30Z is 2026-11-10 00:30 in Lagos (UTC+1).
    const now = new Date("2026-11-09T23:30:00Z");
    expect(daysUntil("2026-11-10", now)).toBe(0);
    expect(daysUntil("2026-11-09", now)).toBe(-1);
  });

  it("converts a full timestamp to its Lagos date", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    // 23:30Z on the 10th is 00:30 on the 11th in Lagos.
    expect(daysUntil("2026-11-10T23:30:00Z", now)).toBe(1);
  });
});

describe("daysUntil with an unreadable date", () => {
  it("returns NaN instead of throwing", () => {
    expect(Number.isNaN(daysUntil("not a date", new Date("2026-11-10T12:00:00Z")))).toBe(true);
  });
});

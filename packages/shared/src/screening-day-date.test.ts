import { lagosToday } from "./learning/expiry";
import { earliestScreeningDayDate, screeningDayDateProblem } from "./screening-day-date";

// 2026-11-02 23:30 UTC is already 2026-11-03 00:30 in Lagos.
const lateUtc = new Date("2026-11-02T23:30:00Z");
const noon = new Date("2026-11-02T11:00:00Z");

describe("screening day date", () => {
  it("counts days in Lagos, not UTC", () => {
    expect(lagosToday(lateUtc)).toBe("2026-11-03");
    expect(lagosToday(noon)).toBe("2026-11-02");
    expect(earliestScreeningDayDate(lateUtc)).toBe("2026-11-04");
  });

  it("accepts tomorrow and later, refuses today and earlier", () => {
    expect(screeningDayDateProblem("2026-11-03", noon)).toBeNull();
    expect(screeningDayDateProblem("2026-12-05", noon)).toBeNull();
    expect(screeningDayDateProblem("2026-11-02", noon)).toBe("Choose a date after today.");
    expect(screeningDayDateProblem("2026-10-01", noon)).toBe("Choose a date after today.");
    // Late evening UTC is already the next Lagos day, so "tomorrow" moves with it.
    expect(screeningDayDateProblem("2026-11-03", lateUtc)).toBe("Choose a date after today.");
    expect(screeningDayDateProblem("2026-11-04", lateUtc)).toBeNull();
  });

  it("explains a date that is empty, mis-typed or impossible", () => {
    expect(screeningDayDateProblem("", noon)).toBe("When is it happening?");
    expect(screeningDayDateProblem("next friday", noon)).toMatch(/year-month-day/);
    expect(screeningDayDateProblem("5/12/2026", noon)).toMatch(/year-month-day/);
    expect(screeningDayDateProblem("2026-02-31", noon)).toMatch(/does not exist/);
  });
});

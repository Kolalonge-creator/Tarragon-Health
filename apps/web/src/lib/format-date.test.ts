/**
 * Lagos calendar helpers.
 *
 * Every case here is one that `new Date().toISOString().slice(0, 10)` gets
 * wrong: Lagos is UTC+1, so for the first hour of every local day the UTC
 * date is still yesterday, and on the 1st of a month or a year it is still
 * the prior accounting period.
 */

import {
  lagosToday,
  lagosDaysAgo,
  lagosMonth,
  lagosMonthStart,
  lagosYear,
  lagosYearStart,
  lagosDateTimeInputValue,
  lagosDateTimeInputToIso,
} from "./format-date";

/** 00:30 in Lagos on 15 September 2026 — 23:30 UTC on the 14th. */
const LAGOS_HALF_PAST_MIDNIGHT = new Date("2026-09-14T23:30:00Z");
/** 00:30 in Lagos on 1 September 2026 — 23:30 UTC on 31 August. */
const LAGOS_FIRST_OF_MONTH = new Date("2026-08-31T23:30:00Z");
/** 00:30 in Lagos on 1 January 2027 — 23:30 UTC on 31 December 2026. */
const LAGOS_NEW_YEAR = new Date("2026-12-31T23:30:00Z");
/** Mid-afternoon, where UTC and Lagos agree on the date. */
const LAGOS_AFTERNOON = new Date("2026-09-15T13:00:00Z");

describe("lagosToday", () => {
  it("is already the new day at 00:30 Lagos time", () => {
    expect(LAGOS_HALF_PAST_MIDNIGHT.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(lagosToday(LAGOS_HALF_PAST_MIDNIGHT)).toBe("2026-09-15");
  });

  it("agrees with UTC during the rest of the day", () => {
    expect(lagosToday(LAGOS_AFTERNOON)).toBe("2026-09-15");
  });
});

describe("month and year boundaries", () => {
  it("is in the new accounting period at 00:30 on the 1st", () => {
    expect(lagosToday(LAGOS_FIRST_OF_MONTH)).toBe("2026-09-01");
    expect(lagosMonth(LAGOS_FIRST_OF_MONTH)).toBe("2026-09");
    expect(lagosMonthStart(LAGOS_FIRST_OF_MONTH)).toBe("2026-09-01");
  });

  it("is in the new year at 00:30 on 1 January", () => {
    expect(lagosYear(LAGOS_NEW_YEAR)).toBe(2027);
    expect(lagosYearStart(lagosYear(LAGOS_NEW_YEAR))).toBe("2027-01-01");
  });

  it("takes an explicit year for a prior-year report", () => {
    expect(lagosYearStart(2025)).toBe("2025-01-01");
  });
});

describe("lagosDaysAgo", () => {
  it("counts back from the Lagos day, not the UTC one", () => {
    expect(lagosDaysAgo(90, LAGOS_HALF_PAST_MIDNIGHT)).toBe("2026-06-17");
    expect(lagosDaysAgo(1, LAGOS_FIRST_OF_MONTH)).toBe("2026-08-31");
  });
});

describe("datetime-local round trip", () => {
  it("prefills the Lagos wall clock, not the UTC one", () => {
    // The old behaviour, toISOString().slice(0, 16), gave 22:05 for this instant.
    const instant = new Date("2026-09-15T22:05:00Z");
    expect(lagosDateTimeInputValue(instant)).toBe("2026-09-15T23:05");
  });

  it("reads a value back as the instant it names in Lagos", () => {
    expect(lagosDateTimeInputToIso("2026-09-15T23:05")).toBe("2026-09-15T22:05:00.000Z");
  });

  it("round trips without drifting", () => {
    const instant = new Date("2026-09-15T22:05:00Z");
    expect(lagosDateTimeInputToIso(lagosDateTimeInputValue(instant))).toBe(instant.toISOString());
  });

  it("accepts a value that carries seconds", () => {
    expect(lagosDateTimeInputToIso("2026-09-15T23:05:30")).toBe("2026-09-15T22:05:30.000Z");
  });

  it("refuses a blank or malformed value rather than guessing", () => {
    expect(lagosDateTimeInputToIso("")).toBeNull();
    expect(lagosDateTimeInputToIso("not a date")).toBeNull();
    expect(lagosDateTimeInputToIso("2026-09-15")).toBeNull();
  });

  it("starts the NDPC 72-hour clock from the moment the operator meant", () => {
    // An incident discovered at 09:00 Lagos must be reportable until 09:00
    // Lagos three days later, not 07:00 as the old UTC wall clock produced.
    const discoveredAt = lagosDateTimeInputToIso("2026-09-15T09:00");
    expect(discoveredAt).not.toBeNull();
    const deadline = new Date(new Date(discoveredAt as string).getTime() + 72 * 60 * 60 * 1000);
    expect(lagosDateTimeInputValue(deadline)).toBe("2026-09-18T09:00");
  });
});

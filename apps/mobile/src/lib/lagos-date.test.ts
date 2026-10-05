import {
  addDays,
  daysBetween,
  isValidLocalDate,
  lagosDayStartUtcMs,
  lagosHour,
  lagosLocalDate,
  lagosTimeToUtcMs,
  weekdayOf,
  weekStart,
} from "./lagos-date";

describe("lagosLocalDate", () => {
  it("rolls to the next Lagos day at 23:00 UTC", () => {
    expect(lagosLocalDate(Date.parse("2026-10-03T22:59:59Z"))).toBe("2026-10-03");
    expect(lagosLocalDate(Date.parse("2026-10-03T23:00:00Z"))).toBe("2026-10-04");
    expect(lagosLocalDate(Date.parse("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("gives the same day whatever timezone the phone is set to", () => {
    const instant = Date.parse("2026-10-03T23:30:00Z");
    const original = process.env.TZ;
    try {
      for (const tz of ["America/New_York", "Europe/London", "Pacific/Auckland", "Africa/Lagos"]) {
        process.env.TZ = tz;
        expect(lagosLocalDate(instant)).toBe("2026-10-04");
        expect(lagosHour(instant)).toBe(0);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("day arithmetic", () => {
  it("adds days across month, year and leap day", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-03", -3)).toBe("2026-09-30");
  });

  it("counts days between exactly", () => {
    expect(daysBetween("2026-10-01", "2026-10-03")).toBe(2);
    expect(daysBetween("2026-10-03", "2026-10-01")).toBe(-2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("finds the Monday of the week (weeks run Monday to Sunday)", () => {
    expect(weekdayOf("2026-10-03")).toBe(6); // Saturday
    expect(weekStart("2026-10-03")).toBe("2026-09-28");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // Sunday belongs to the week that began on Monday
  });

  it("rejects malformed dates", () => {
    expect(isValidLocalDate("2026-10-03")).toBe(true);
    expect(isValidLocalDate("2026-02-30")).toBe(false);
    expect(isValidLocalDate("2026-1-3")).toBe(false);
    expect(() => addDays("not-a-date", 1)).toThrow(RangeError);
  });
});

describe("lagosTimeToUtcMs", () => {
  it("converts Lagos wall-clock time to UTC", () => {
    expect(lagosTimeToUtcMs("2026-10-03", "08:00")).toBe(Date.parse("2026-10-03T07:00:00Z"));
    expect(lagosTimeToUtcMs("2026-10-03", "00:30")).toBe(Date.parse("2026-10-02T23:30:00Z"));
    expect(lagosDayStartUtcMs("2026-10-03")).toBe(Date.parse("2026-10-02T23:00:00Z"));
  });

  it("returns null for malformed times", () => {
    for (const t of ["8:00", "24:00", "07:60", "ab:cd", ""]) expect(lagosTimeToUtcMs("2026-10-03", t)).toBeNull();
  });
});

import { describe, expect, it } from "@jest/globals";
import { calendarAgeInYears } from "./calendar-age";

describe("calendarAgeInYears", () => {
  it("does not count a birthday that is still tomorrow in Lagos", () => {
    expect(calendarAgeInYears("2008-11-07", new Date("2026-11-06T12:00:00Z"))).toBe(17);
    expect(calendarAgeInYears("2008-11-07", new Date("2026-11-06T23:30:00Z"))).toBe(18);
  });
  it("is null for a missing, malformed or future date", () => {
    expect(calendarAgeInYears(null, new Date())).toBeNull();
    expect(calendarAgeInYears("nope", new Date())).toBeNull();
    expect(calendarAgeInYears("2030-01-01", new Date("2026-01-01T00:00:00Z"))).toBeNull();
  });
});

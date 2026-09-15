import { describe, expect, it } from "@jest/globals";
import { ageMonthsFromDateOfBirth, developmentalAgeBandFor } from "./age-band";

describe("ageMonthsFromDateOfBirth", () => {
  it("computes months using the same average-day-length division as the DB trigger", () => {
    expect(ageMonthsFromDateOfBirth("2026-01-01", new Date("2026-07-01T00:00:00.000Z"))).toBe(5);
    // NOT 24 — an exact 2nd birthday reads as 23 months under this
    // approximation, matching private.score_developmental_screening exactly
    // (see this function's own comment on why that's the point).
    expect(ageMonthsFromDateOfBirth("2024-08-29", new Date("2026-08-29T00:00:00.000Z"))).toBe(23);
  });
});

describe("developmentalAgeBandFor", () => {
  it("matches the seeded bands", () => {
    expect(developmentalAgeBandFor(6)).toEqual({ min: 4, max: 8 });
    expect(developmentalAgeBandFor(24)).toEqual({ min: 24, max: 35 });
    expect(developmentalAgeBandFor(60)).toEqual({ min: 48, max: 60 });
  });

  it("returns null outside the covered range", () => {
    expect(developmentalAgeBandFor(2)).toBeNull();
    expect(developmentalAgeBandFor(72)).toBeNull();
  });
});

import { describe, expect, it } from "@jest/globals";
import { isPossiblyMinor } from "./context";

const FIXED_NOW = new Date("2026-08-29T12:00:00.000Z");

describe("isPossiblyMinor", () => {
  it("returns null when no date of birth is on file, rather than guessing", () => {
    expect(isPossiblyMinor(null, FIXED_NOW)).toBeNull();
  });

  it("returns false for a clearly-adult date of birth", () => {
    expect(isPossiblyMinor("1990-01-01", FIXED_NOW)).toBe(false);
  });

  it("returns true for a clearly-minor date of birth", () => {
    expect(isPossiblyMinor("2015-01-01", FIXED_NOW)).toBe(true);
  });

  it("treats someone who turns 18 later this year as still a minor", () => {
    // Born 2008-12-01: turns 18 on 2026-12-01, after FIXED_NOW (2026-08-29).
    expect(isPossiblyMinor("2008-12-01", FIXED_NOW)).toBe(true);
  });

  it("treats someone whose 18th birthday already passed this year as an adult", () => {
    // Born 2008-01-01: turned 18 on 2026-01-01, before FIXED_NOW.
    expect(isPossiblyMinor("2008-01-01", FIXED_NOW)).toBe(false);
  });

  it("treats today as the birthday itself as already turned 18 (>=, not >)", () => {
    expect(isPossiblyMinor("2008-08-29", FIXED_NOW)).toBe(false);
  });
});

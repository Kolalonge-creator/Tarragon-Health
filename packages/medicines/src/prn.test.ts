import { describe, expect, it } from "@jest/globals";
import { checkPrnDose, validatePrnLimits, type PrnBounds } from "./prn";
import { PRN_CASES } from "./prn.fixtures";
import { lagosTimeToUtcMs } from "./lagos";

const ms = (s: string) => lagosTimeToUtcMs(s.slice(0, 10), s.slice(11));
const bounds: PrnBounds = { minGapMinutes: [15, 1440], dailyMax: [1, 24] };

describe("checkPrnDose (shared cases)", () => {
  for (const c of PRN_CASES) {
    it(c.name, () => {
      expect(checkPrnDose(c.limits, c.prior.map(ms), ms(c.dose))).toEqual(c.expect);
    });
  }
  it("gives the same answer whatever order the earlier doses arrive in", () => {
    const prior = ["2026-10-07T06:00", "2026-10-07T12:00", "2026-10-07T15:00"].map(ms);
    const limits = { minGapMinutes: null, dailyMax: 3 };
    expect(checkPrnDose(limits, [...prior].reverse(), ms("2026-10-07T18:00"))).toEqual(checkPrnDose(limits, prior, ms("2026-10-07T18:00")));
  });
});

describe("validatePrnLimits", () => {
  it("accepts a gap, a most, or both", () => {
    expect(validatePrnLimits({ minGapMinutes: 240 }, bounds)).toEqual({ ok: true, limits: { minGapMinutes: 240, dailyMax: null } });
    expect(validatePrnLimits({ dailyMax: 4 }, bounds)).toEqual({ ok: true, limits: { minGapMinutes: null, dailyMax: 4 } });
    expect(validatePrnLimits({ minGapMinutes: 15, dailyMax: 24 }, bounds)).toMatchObject({ ok: true });
  });
  it("refuses nothing set, and values outside the signed bounds or not whole numbers", () => {
    expect(validatePrnLimits({}, bounds)).toEqual({ ok: false, errors: ["empty"] });
    expect(validatePrnLimits({ minGapMinutes: 14 }, bounds)).toEqual({ ok: false, errors: ["minGapMinutes"] });
    expect(validatePrnLimits({ minGapMinutes: 1441 }, bounds)).toMatchObject({ ok: false });
    expect(validatePrnLimits({ dailyMax: 0 }, bounds)).toEqual({ ok: false, errors: ["dailyMax"] });
    expect(validatePrnLimits({ dailyMax: 2.5, minGapMinutes: "60" }, bounds)).toEqual({ ok: false, errors: ["minGapMinutes", "dailyMax"] });
  });
});

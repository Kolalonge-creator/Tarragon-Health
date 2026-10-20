import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GLUCOSE_MMOL_TO_MGDL } from "./index";
import { BAND_MMOL_TO_MGDL, bandCaption, glucoseTrendBand, trendBandsEligible, weightTrendBand } from "./trend-bands";

describe("trend bands (S47a 4.6)", () => {
  it("uses the same mmol/L to mg/dL factor as the rest of the platform", () => {
    expect(BAND_MMOL_TO_MGDL).toBe(GLUCOSE_MMOL_TO_MGDL);
  });

  it("the standard glucose band is the time-in-range band already used by the diabetes view", () => {
    const tir = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "apps", "web", "src", "lib", "vitals", "time-in-range.ts"), "utf8");
    const low = Number(/DEFAULT_TIR_LOW = ([0-9.]+)/.exec(tir)![1]);
    const high = Number(/DEFAULT_TIR_HIGH = ([0-9.]+)/.exec(tir)![1]);
    const b = glucoseTrendBand("mmol_l");
    expect([b.low, b.high]).toEqual([low, high]);
    expect(b.origin).toBe("standard");
  });

  it("converts to mg/dL for a meter that reads mg/dL, and prefers a care-team band", () => {
    expect(glucoseTrendBand("mg_dl")).toEqual({ low: 70, high: 180, origin: "standard" });
    expect(glucoseTrendBand("mmol_l", { low: 4.4, high: 7.2 })).toEqual({ low: 4.4, high: 7.2, origin: "care_team" });
  });

  it("weight band is the healthy BMI band at the person's own height, and absent without a usable height", () => {
    expect(weightTrendBand(170)).toEqual({ low: 53.5, high: 72, origin: "standard" });
    expect(weightTrendBand(null)).toBeNull();
    expect(weightTrendBand(undefined)).toBeNull();
    expect(weightTrendBand(20)).toBeNull();
    expect(weightTrendBand(Number.NaN)).toBeNull();
  });

  it("the caption names the band in words, says where it comes from, and is not a diagnosis", () => {
    const text = bandCaption("glucose", glucoseTrendBand("mmol_l"), "mmol/L");
    expect(text).toContain("3.9");
    expect(text).toContain("10");
    expect(text).toContain("the usual target range");
    expect(text).toContain("not a diagnosis");
    expect(bandCaption("weight", { low: 1, high: 2, origin: "care_team" }, "kg")).toContain("your care team's target range");
    expect(text).not.toContain("—");
  });

  describe("trendBandsEligible", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const ok = { moduleEnabled: true, dateOfBirth: "1980-05-01", isPregnant: false, now };
    it("is true for an adult who is not pregnant with the module on", () => {
      expect(trendBandsEligible(ok)).toBe(true);
      expect(trendBandsEligible({ ...ok, isPregnant: null })).toBe(true);
    });
    it("is false when the module is off or unknown", () => {
      expect(trendBandsEligible({ ...ok, moduleEnabled: false })).toBe(false);
      expect(trendBandsEligible({ ...ok, moduleEnabled: null })).toBe(false);
      expect(trendBandsEligible({ ...ok, moduleEnabled: undefined })).toBe(false);
    });
    it("is false for a child, for someone turning 18 later this year, for no or a bad date of birth, and for a pregnant person", () => {
      expect(trendBandsEligible({ ...ok, dateOfBirth: "2012-01-01" })).toBe(false);
      expect(trendBandsEligible({ ...ok, dateOfBirth: "2008-12-01" })).toBe(false);
      expect(trendBandsEligible({ ...ok, dateOfBirth: "2008-10-20" })).toBe(true);
      expect(trendBandsEligible({ ...ok, dateOfBirth: null })).toBe(false);
      expect(trendBandsEligible({ ...ok, dateOfBirth: "not a date" })).toBe(false);
      expect(trendBandsEligible({ ...ok, isPregnant: true })).toBe(false);
    });
  });
});

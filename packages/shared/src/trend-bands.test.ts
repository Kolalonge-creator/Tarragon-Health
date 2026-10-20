import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GLUCOSE_MMOL_TO_MGDL } from "./index";
import { BAND_MMOL_TO_MGDL, bandCaption, glucoseTrendBand, weightTrendBand } from "./trend-bands";

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
});

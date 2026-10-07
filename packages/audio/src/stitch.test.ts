import { describe, expect, it } from "@jest/globals";
import { phraseText } from "./resolve";
import { scriptText } from "./language";
import {
  numClipId,
  stitchAdherence,
  stitchBloodPressure,
  stitchGlucose,
  stitchHbA1c,
  stitchPulse,
  stitchSteps,
  stitchStreak,
  stitchWeeklyBloodPressureAverage,
  stitchWeight,
  type Phrase,
} from "./stitch";
import { realManifest } from "./test-helpers";

const ids = (p: Phrase | null) => p?.steps.map((s) => s.id);
const say = (p: Phrase | null, lang: "en" = "en") => (p ? phraseText(p, lang, scriptText) : null);

describe("NUM stitching", () => {
  it("builds the spec's example: NUM-P01 + NUM-148 + NUM-P02 + NUM-094", () => {
    expect(ids(stitchBloodPressure(148, 94))).toEqual(["NUM-P01", "NUM-148", "NUM-P02", "NUM-094", "NUM-P24"]);
    expect(say(stitchBloodPressure(148, 94))).toBe("Your blood pressure reading is 148 over 94 millimetres of mercury");
  });

  it("zero-pads clip ids and accepts both ends of the kit (0 and 600)", () => {
    expect(numClipId(7)).toBe("NUM-007");
    expect(ids(stitchPulse(0))).toEqual(["NUM-P08", "NUM-000", "NUM-P09"]);
    expect(ids(stitchPulse(600))).toEqual(["NUM-P08", "NUM-600", "NUM-P09"]);
  });

  it("refuses anything it cannot say exactly: no clip, no guess", () => {
    for (const bad of [601, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stitchBloodPressure(bad, 80)).toBeNull();
      expect(stitchBloodPressure(120, bad)).toBeNull();
      expect(stitchPulse(bad)).toBeNull();
      expect(stitchGlucose(bad, "mg/dl")).toBeNull();
      expect(stitchStreak(bad)).toBeNull();
    }
    expect(stitchWeight(Number.NaN)).toBeNull();
    expect(stitchWeight(-3)).toBeNull();
    expect(stitchWeight(601)).toBeNull();
    expect(stitchGlucose(Number.NaN, "mmol/l")).toBeNull();
  });

  it("says glucose in either unit, with a decimal word for mmol/L", () => {
    expect(ids(stitchGlucose(112, "mg/dl"))).toEqual(["NUM-P03", "NUM-112", "NUM-P04"]);
    expect(ids(stitchGlucose(7.2, "mmol/l"))).toEqual(["NUM-P03", "NUM-007", "NUM-D01", "NUM-002", "NUM-P05"]);
    expect(say(stitchGlucose(7.2, "mmol/l"))).toBe("Your blood sugar reading is 7.2 millimoles per litre");
    // A whole value needs no decimal word; the third decimal is rounded to the tenth the meter shows.
    expect(ids(stitchGlucose(7, "mmol/l"))).toEqual(["NUM-P03", "NUM-007", "NUM-P05"]);
    expect(ids(stitchGlucose(7.04, "mmol/l"))).toEqual(["NUM-P03", "NUM-007", "NUM-P05"]);
    expect(ids(stitchGlucose(7.26, "mmol/l"))).toContain("NUM-003");
  });

  it("says weight and HbA1c with one decimal", () => {
    expect(ids(stitchWeight(72.5))).toEqual(["NUM-P06", "NUM-072", "NUM-D01", "NUM-005", "NUM-P07"]);
    expect(say(stitchWeight(72.5))).toBe("Your weight is 72.5 kilograms");
    expect(ids(stitchHbA1c(6.9))).toEqual(["NUM-P10", "NUM-006", "NUM-D01", "NUM-009", "NUM-P11"]);
  });

  it("says a weekly average with an optional comparison", () => {
    expect(ids(stitchWeeklyBloodPressureAverage(138, 86))).toEqual(["NUM-P12", "NUM-138", "NUM-P02", "NUM-086", "NUM-P24"]);
    expect(ids(stitchWeeklyBloodPressureAverage(138, 86, "higher"))?.at(-1)).toBe("NUM-P13");
    expect(ids(stitchWeeklyBloodPressureAverage(138, 86, "lower"))?.at(-1)).toBe("NUM-P14");
    expect(ids(stitchWeeklyBloodPressureAverage(138, 86, "same"))?.at(-1)).toBe("NUM-P15");
    expect(stitchWeeklyBloodPressureAverage(1000, 86)).toBeNull();
  });

  it("says adherence and streaks, and refuses taking more doses than there were", () => {
    expect(ids(stitchAdherence(5, 7))).toEqual(["NUM-P16", "NUM-005", "NUM-P17", "NUM-007", "NUM-P18"]);
    expect(stitchAdherence(8, 7)).toBeNull();
    expect(stitchAdherence(-1, 7)).toBeNull();
    expect(ids(stitchStreak(12))).toEqual(["NUM-P19", "NUM-012", "NUM-P20"]);
  });

  it("says steps exactly up to 600, to the nearest 500 from 1000 to 20000, and not at all in between or above", () => {
    expect(ids(stitchSteps(432))).toEqual(["NUM-P21", "NUM-432", "NUM-P23"]);
    expect(ids(stitchSteps(2480))).toEqual(["NUM-P21", "NUM-S2500", "NUM-P23"]);
    expect(say(stitchSteps(2480))).toBe("Today you have walked 2500 steps.");
    expect(ids(stitchSteps(1000))).toContain("NUM-S1000");
    expect(ids(stitchSteps(20000))).toContain("NUM-S20000");
    expect(stitchSteps(601)).toBeNull();
    expect(stitchSteps(749)).toBeNull();
    expect(ids(stitchSteps(20240))).toContain("NUM-S20000");
    expect(stitchSteps(20300)).toBeNull();
    expect(stitchSteps(-5)).toBeNull();
    expect(stitchSteps(Number.NaN)).toBeNull();
  });

  it("only ever names clips that exist in the manifest, for every value the kit can say", () => {
    const known = new Set(realManifest().clips.map((c) => c.id));
    const all: (Phrase | null)[] = [];
    for (let n = 0; n <= 600; n += 7) all.push(stitchBloodPressure(n, 600 - n), stitchPulse(n), stitchGlucose(n, "mg/dl"), stitchStreak(n));
    for (let n = 0; n <= 20500; n += 250) all.push(stitchSteps(n));
    for (let t = 0; t <= 600; t += 3) all.push(stitchWeight(t / 10 + 40), stitchGlucose(t / 10, "mmol/l"), stitchHbA1c(t / 100 + 4));
    for (const p of all) for (const s of p?.steps ?? []) expect([s.id, known.has(s.id)]).toEqual([s.id, true]);
  });
});

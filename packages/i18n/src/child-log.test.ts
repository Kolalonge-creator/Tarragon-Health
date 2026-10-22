import { describe, expect, it } from "@jest/globals";
import { childLog, CDL_COPY_NEEDS_REVIEW } from "./child-log";
import { en } from "./index";

describe("S68b child log copy", () => {
  const entries = Object.entries(childLog);

  it("is merged into the English catalogue under the cdl. prefix", () => {
    for (const [k, v] of entries) expect((en as Record<string, string>)[k]).toBe(v);
  });

  it("never says 'your doctor', never uses an em dash, never claims a cure", () => {
    for (const [, v] of entries) expect(v).not.toMatch(/your doctor|—|\bcure|instant doctor|free healthcare/i);
  });

  it("uses kg and cm only (no pounds, ounces, inches or feet)", () => {
    for (const [, v] of entries) expect(v).not.toMatch(/\b(lb|lbs|pounds?|oz|ounces?|inch(es)?|feet|foot)\b/i);
  });

  it("the three growth bands are words, and each shape has a word beside it (not colour alone)", () => {
    for (const band of ["growing_well", "keep_an_eye_on", "talk_to_care_team"] as const) {
      expect(childLog[`cdl.growth.band_${band}`]).toBeTruthy();
      expect(childLog[`cdl.growth.help_${band}`]).toBeTruthy();
    }
    expect(childLog["cdl.growth.shape_circle"]).toMatch(/growing well/i);
    expect(childLog["cdl.growth.shape_diamond"]).toMatch(/keep an eye on/i);
    expect(childLog["cdl.growth.shape_triangle"]).toMatch(/talk to your care team/i);
    expect(childLog["cdl.growth.intro"]).toMatch(/not a diagnosis/i);
  });

  it("the crisis lead says go to the nearest clinic now", () => {
    expect(childLog["cdl.crisis.lead"]).toMatch(/nearest clinic now/i);
  });

  it("no band or vaccine sentence diagnoses or names a condition", () => {
    for (const [k, v] of entries) {
      if (k === "cdl.growth.intro" || k === "cdl.pdf.footer") continue;
      expect([k, /depress|malnutrition|wasting|stunt|diagnos|disease|anaemia|infection|protected|immune/i.test(v)]).toEqual([k, false]);
    }
  });

  it("every placeholder key exists", () => {
    for (const k of CDL_COPY_NEEDS_REVIEW) expect(childLog[k]).toBeTruthy();
  });
});

import { describe, expect, it } from "@jest/globals";
import { maternalChild, MCH_COPY_NEEDS_REVIEW } from "./maternal-child";
import { en } from "./index";

describe("S68 copy", () => {
  const entries = Object.entries(maternalChild);

  it("is merged into the English catalogue under the mch. prefix", () => {
    for (const [k, v] of entries) expect((en as Record<string, string>)[k]).toBe(v);
  });

  it("never says 'your doctor', never uses an em dash, never claims a cure", () => {
    for (const [, v] of entries) {
      expect(v).not.toMatch(/your doctor|—|\bcure|instant doctor|free healthcare/i);
    }
  });

  it("never names a vaccine, a condition or a diagnosis outside the 'not a diagnosis' line (INV-07 spirit)", () => {
    for (const [k, v] of entries) {
      if (k === "mch.epds.not_a_diagnosis" || k === "mch.growth.reference_line") continue;
      expect([k, /depress|malnutrition|wasting|stunt|diagnos|disease|anaemia|infection/i.test(v)]).toEqual([k, false]);
    }
  });

  it("the EPDS copy is never worded as a diagnosis", () => {
    for (const k of ["mch.epds.possible", "mch.epds.probable", "mch.epds.thanks"] as const) expect(maternalChild[k]).not.toMatch(/you have|you are depressed|diagnos/i);
    expect(maternalChild["mch.epds.not_a_diagnosis"]).toMatch(/not a diagnosis/);
  });

  it("every placeholder key exists", () => {
    for (const k of MCH_COPY_NEEDS_REVIEW) expect(maternalChild[k]).toBeTruthy();
  });

  it("the loss path has no baby words", () => {
    expect(maternalChild["mch.life.loss_note"]).not.toMatch(/baby|birth|congratulat|feed/i);
  });
});

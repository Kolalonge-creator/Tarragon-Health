import { describe, expect, it } from "@jest/globals";
import { en, OUTPUT_KINDS, OUTPUT_KIND_KEYS, outputKindFor, outputKindHintKey, t } from "./index";

describe("outputKindFor", () => {
  it("with no facts the answer is the weakest kind, never the strongest", () => {
    expect(outputKindFor()).toBe("automated_information");
    expect(outputKindFor({})).toBe("automated_information");
    expect(outputKindFor({ signedByClinician: null, reviewedByClinician: null })).toBe("automated_information");
  });
  it("a clinician review makes it reviewed guidance; a signed decision makes it a decision", () => {
    expect(outputKindFor({ reviewedByClinician: true })).toBe("clinician_reviewed_guidance");
    expect(outputKindFor({ signedByClinician: true })).toBe("clinician_decision");
  });
  it("the strongest supported kind wins, and a false fact grants nothing", () => {
    expect(outputKindFor({ reviewedByClinician: true, signedByClinician: true })).toBe("clinician_decision");
    expect(outputKindFor({ reviewedByClinician: false, signedByClinician: false })).toBe("automated_information");
  });
});

describe("the three labels", () => {
  it("there are exactly three kinds and every one has a label and a hint in English", () => {
    expect([...OUTPUT_KINDS]).toEqual(["automated_information", "clinician_reviewed_guidance", "clinician_decision"]);
    for (const kind of OUTPUT_KINDS) {
      const k = OUTPUT_KIND_KEYS[kind];
      expect(en[k.label].length).toBeGreaterThan(3);
      expect(en[k.hint].length).toBeGreaterThan(20);
    }
  });
  it("the three labels differ from each other (a person can tell them apart by the words alone, not colour)", () => {
    const labels = OUTPUT_KINDS.map((k) => t(OUTPUT_KIND_KEYS[k].label, "en"));
    expect(new Set(labels).size).toBe(3);
  });
  it("the automated hint says that no one has checked it and that it is not a diagnosis", () => {
    const hint = t(OUTPUT_KIND_KEYS.automated_information.hint, "en");
    expect(hint).toMatch(/No one on your care team has checked it/);
    expect(hint).toMatch(/not a diagnosis/);
  });
  it("only the decision kind speaks of a named, signing clinician; the reviewed kind says it is not about you", () => {
    expect(t(OUTPUT_KIND_KEYS.clinician_decision.hint, "en")).toMatch(/named clinician/);
    expect(t(OUTPUT_KIND_KEYS.clinician_reviewed_guidance.hint, "en")).toMatch(/not a decision about you/);
    expect(t(OUTPUT_KIND_KEYS.automated_information.hint, "en")).not.toMatch(/signed|named clinician/);
  });
  it("the staff wording never says 'your record' or 'your care team' (a clinician reads a patient's chart), and keeps each kind's meaning", () => {
    for (const kind of OUTPUT_KINDS) {
      const staff = t(outputKindHintKey(kind, "staff"), "en");
      expect(staff).not.toMatch(/\byour\b/i);
      expect(staff).not.toBe(t(outputKindHintKey(kind, "patient"), "en"));
    }
    expect(t(outputKindHintKey("automated_information", "staff"), "en")).toMatch(/No clinician has checked it/);
    expect(t(outputKindHintKey("clinician_decision", "staff"), "en")).toMatch(/named clinician/);
    expect(outputKindHintKey("automated_information")).toBe(OUTPUT_KIND_KEYS.automated_information.hint);
  });
  it("follow the copy rules: no dash characters, never 'your doctor', no promise of a cure or instant answer", () => {
    for (const kind of OUTPUT_KINDS) {
      for (const key of [OUTPUT_KIND_KEYS[kind].label, OUTPUT_KIND_KEYS[kind].hint, OUTPUT_KIND_KEYS[kind].staffHint]) {
        const v = en[key];
        expect(v).not.toMatch(/[–—]/);
        expect(v).not.toMatch(/your doctor|cure|instant|free healthcare/i);
      }
    }
  });
});

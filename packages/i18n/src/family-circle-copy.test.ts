import { describe, expect, it } from "@jest/globals";
import { FAMILY_CIRCLE_COPY_REVIEW, FAMILY_NOTE_MAX, familyCircleCopy } from "./family-circle-copy";
import { en } from "./en";
import ledger from "./reviewed-strings-ledger.json";
import { inScope } from "./reviewed-ledger";

const keys = Object.keys(familyCircleCopy) as (keyof typeof familyCircleCopy)[];

describe("Family circle copy (gift share and the doctor's line for the family)", () => {
  it("is part of the English catalogue and every key is under a review prefix", () => {
    for (const k of keys) {
      expect(en[k]).toBe(familyCircleCopy[k]);
      expect(FAMILY_CIRCLE_COPY_REVIEW.prefixes.some((p) => k.startsWith(p))).toBe(true);
    }
  });

  it("carries the CMO and DPO approval (2026-11-04), and its prefixes are outside the reviewed-strings ledger namespaces", () => {
    expect(FAMILY_CIRCLE_COPY_REVIEW.status).toBe("cmo_reviewed");
    expect(FAMILY_CIRCLE_COPY_REVIEW.reviewer).toMatch(/Chief Medical Officer/);
    expect(FAMILY_CIRCLE_COPY_REVIEW.reviewedOn).toBe("2026-11-04");
    for (const k of keys) expect(inScope(k, ledger)).toBe(false);
  });

  it("has no em dashes, never says doctor-led and never mentions WhatsApp", () => {
    for (const k of keys) {
      expect(familyCircleCopy[k]).not.toContain("—");
      expect(familyCircleCopy[k].toLowerCase()).not.toContain("doctor-led");
      expect(familyCircleCopy[k].toLowerCase()).not.toContain("whatsapp");
    }
  });

  it("names no condition and no medicine", () => {
    for (const k of keys) {
      expect(familyCircleCopy[k]).not.toMatch(/hypertens|diabet|asthma|cancer|hiv|sickle|stroke|kidney|pregnan|insulin|metformin|amlodipine/i);
    }
  });

  it("the doctor sees the plain-words hint, and the length limit matches the database", () => {
    expect(familyCircleCopy["familynote.form.hint"]).toBe("Plain words. No results, diagnoses or medicine names.");
    expect(FAMILY_NOTE_MAX).toBe(280);
  });

  it("'Share the usual' says exactly what it ticks", () => {
    const hint = familyCircleCopy["giftshare.usual_hint"].toLowerCase();
    for (const word of ["blood pressure", "doses", "appointments", "check on you", "monthly report"]) expect(hint).toContain(word);
  });
});

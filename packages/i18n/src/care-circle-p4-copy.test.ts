import { describe, expect, it } from "@jest/globals";
import { CIRCLE_P4_COPY_REVIEW, circleP4Copy } from "./care-circle-p4-copy";
import { en } from "./en";
import ledger from "./reviewed-strings-ledger.json";
import { inScope } from "./reviewed-ledger";

const keys = Object.keys(circleP4Copy) as (keyof typeof circleP4Copy)[];

describe("Care Circle Phase 4 copy (family contact, timeline)", () => {
  it("is in the English catalogue, under its review prefix, outside the reviewed-strings ledger", () => {
    for (const k of keys) {
      expect(en[k]).toBe(circleP4Copy[k]);
      expect(CIRCLE_P4_COPY_REVIEW.prefixes.some((p) => k.startsWith(p))).toBe(true);
      expect(inScope(k, ledger)).toBe(false);
    }
  });

  it("is still pending CMO review (the 2026-11-04 approval covered Phases 1 to 3 only)", () => {
    expect(CIRCLE_P4_COPY_REVIEW.status).toBe("pending_cmo_review");
  });

  it("follows the copy rules", () => {
    for (const k of keys) {
      const v = circleP4Copy[k];
      expect(v).not.toContain("—");
      expect(v.toLowerCase()).not.toMatch(/doctor-led|your doctor|whatsapp/);
      expect(v).not.toMatch(/hypertens|diabet|asthma|cancer|hiv|sickle|stroke|kidney|pregnan|insulin|metformin|amlodipine/i);
    }
  });

  it("says the contact label grants nothing and is not the emergency contact", () => {
    expect(circleP4Copy["circlep4.contact.hint"]).toMatch(/does not let them see anything more/);
    expect(circleP4Copy["circlep4.contact.hint"]).toMatch(/not your emergency contact/);
  });
});

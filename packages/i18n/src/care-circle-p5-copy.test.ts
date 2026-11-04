import { describe, expect, it } from "@jest/globals";
import { CIRCLE_P5_COPY_REVIEW, circleP5Copy } from "./care-circle-p5-copy";
import { en } from "./en";
import ledger from "./reviewed-strings-ledger.json";
import { inScope } from "./reviewed-ledger";

const keys = Object.keys(circleP5Copy) as (keyof typeof circleP5Copy)[];

describe("Care Circle Phase 5 copy (payer view, admin metrics)", () => {
  it("is in the English catalogue, under its review prefix, outside the reviewed-strings ledger", () => {
    for (const k of keys) {
      expect(en[k]).toBe(circleP5Copy[k]);
      expect(CIRCLE_P5_COPY_REVIEW.prefixes.some((p) => k.startsWith(p))).toBe(true);
      expect(inScope(k, ledger)).toBe(false);
    }
  });

  it("is marked reviewed by the CMO (CC-COPY-P5)", () => {
    expect(CIRCLE_P5_COPY_REVIEW.status).toBe("cmo_reviewed");
  });

  it("follows the copy rules", () => {
    for (const k of keys) {
      const v = circleP5Copy[k];
      expect(v).not.toContain("—");
      expect(v.toLowerCase()).not.toMatch(/doctor-led|your doctor|whatsapp/);
      expect(v).not.toMatch(/hypertens|diabet|asthma|cancer|hiv|sickle|stroke|kidney|pregnan|insulin|metformin|amlodipine/i);
    }
  });

  it("tells the payer that paying grants no access", () => {
    expect(circleP5Copy["circlep5.paid.privacy"]).toMatch(/does not let you see their health information/);
  });
});

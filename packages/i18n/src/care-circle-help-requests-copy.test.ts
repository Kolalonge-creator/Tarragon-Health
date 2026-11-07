import { describe, expect, it } from "@jest/globals";
import { CIRCLE_HELP_REQUESTS_COPY_REVIEW, circleHelpRequestsCopy } from "./care-circle-help-requests-copy";
import { en } from "./en";
import ledger from "./reviewed-strings-ledger.json";
import { inScope } from "./reviewed-ledger";

const keys = Object.keys(circleHelpRequestsCopy) as (keyof typeof circleHelpRequestsCopy)[];

describe("Care Circle typed help requests copy (P22 / PD-08)", () => {
  it("is in the English catalogue, under its review prefix, outside the reviewed-strings ledger", () => {
    for (const k of keys) {
      expect(en[k]).toBe(circleHelpRequestsCopy[k]);
      expect(CIRCLE_HELP_REQUESTS_COPY_REVIEW.prefixes.some((p) => k.startsWith(p))).toBe(true);
      expect(inScope(k, ledger)).toBe(false);
    }
  });

  it("is still proposed: nothing here is marked as reviewed by a build", () => {
    expect(CIRCLE_HELP_REQUESTS_COPY_REVIEW.status).toBe("proposed");
    expect(CIRCLE_HELP_REQUESTS_COPY_REVIEW.reviewer).toBeNull();
  });

  it("has one label for each of the five kinds of help the database accepts", () => {
    for (const t of ["booking", "test_payment", "medicine_collection", "transport", "call_me"]) {
      expect(keys).toContain(`circlehelp.type.${t}`);
    }
  });

  it("follows the copy rules", () => {
    for (const k of keys) {
      const v = circleHelpRequestsCopy[k];
      expect(v).not.toContain("—");
      expect(v.toLowerCase()).not.toMatch(/doctor-led|your doctor|whatsapp|warning/);
      expect(v).not.toMatch(/hypertens|diabet|asthma|cancer|hiv|sickle|stroke|kidney|pregnan|insulin|metformin|amlodipine/i);
    }
  });

  it("says plainly that it is not an emergency service and points to the nearest hospital", () => {
    expect(circleHelpRequestsCopy["circlehelp.not_emergency"]).toMatch(/^This is not an emergency service\./);
    expect(circleHelpRequestsCopy["circlehelp.not_emergency"]).toMatch(/nearest hospital/);
  });
});

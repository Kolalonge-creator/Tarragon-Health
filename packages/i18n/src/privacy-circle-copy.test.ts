import { describe, expect, it } from "@jest/globals";
import { en } from "./en";
import { PRIVACY_CIRCLE_COPY_REVIEW, privacyCircleCopy } from "./privacy-circle-copy";

describe("UI-B copy", () => {
  const entries = Object.entries(privacyCircleCopy);
  it("is in the catalogue under the reviewed prefix", () => {
    for (const [k, v] of entries) {
      expect(PRIVACY_CIRCLE_COPY_REVIEW.prefixes.some((p) => k.startsWith(p))).toBe(true);
      expect((en as Record<string, string>)[k]).toBe(v);
    }
  });
  it("is still pending review: nothing marks it approved", () => {
    expect(PRIVACY_CIRCLE_COPY_REVIEW.status).toBe("pending_cmo_dpo_review");
  });
  it("has no em dash, no 'your doctor', no exclamation mark", () => {
    for (const [k, v] of entries) {
      expect({ k, bad: /—|–|your doctor|!/i.test(v) }).toEqual({ k, bad: false });
    }
  });
  it("states a limit and does not promise more than is true", () => {
    expect(privacyCircleCopy["uib.who.limit"]).toMatch(/not a full lock/);
    expect(privacyCircleCopy["uib.who.care_team.body"]).toMatch(/cannot switch this off here yet/);
    for (const [, v] of entries) expect(v).not.toMatch(/\b(completely|totally|100%|guarantee|anonymous)\b/i);
  });
  it("never says a Care Circle member can see period, cycle or log data (the circle permissions do not include it)", () => {
    // Real Care Circle permissions: adherence_summary, weekly_bp_trend, appointments, red_alerts, pay_for_care.
    for (const [k, v] of entries) {
      if (!/care circle|circle member/i.test(v)) continue;
      expect({ k, bad: /\b(can|could|will|would|may)\s+see\b[^.]*\b(period|cycle|felt|log|track)/i.test(v) }).toEqual({ k, bad: false });
    }
    expect(privacyCircleCopy["uib.who.circle.body"]).toMatch(/^Nothing from this section is shared through your Care Circle/);
    expect(privacyCircleCopy["uib.who.preview.none"]).toMatch(/nothing from this section/);
    // sabotage: the old, untrue wording would have been caught by the same pattern
    expect(/\b(can|could|will|would|may)\s+see\b[^.]*\b(period|cycle|felt|log|track)/i.test("If you give them access: they can see what you log in this section, for example your period days")).toBe(true);
  });
  it("hide note says it deletes nothing", () => {
    expect(privacyCircleCopy["uib.hide.note"]).toMatch(/does not delete anything/);
  });
});

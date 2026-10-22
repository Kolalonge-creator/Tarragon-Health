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
  it("hide note says it deletes nothing", () => {
    expect(privacyCircleCopy["uib.hide.note"]).toMatch(/does not delete anything/);
  });
});

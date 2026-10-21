import { describe, expect, it } from "@jest/globals";
import { VITALS_CARE_V1 } from "@tarragon/clinical";
import { VITALS_CITATIONS, VITALS_OPEN_POINTS, VITALS_RULE_BASIS, VITALS_SIGNING_NOTE, rulesMatchBuild } from "./vitals-triage-basis";

describe("vitals triage guideline basis (CMO sign-off hub)", () => {
  it("has a basis for every rule of the rule set, and none for a rule that does not exist", () => {
    expect(Object.keys(VITALS_RULE_BASIS).sort()).toEqual(VITALS_CARE_V1.rules.map((r) => r.id).sort());
  });

  it("every citation a rule uses is defined", () => {
    const ids = new Set(VITALS_CITATIONS.map((c) => c.id));
    for (const [rule, b] of Object.entries(VITALS_RULE_BASIS)) {
      expect([rule, b.citations.length > 0]).toEqual([rule, true]);
      for (const c of b.citations) expect([rule, ids.has(c)]).toEqual([rule, true]);
    }
  });

  it("states the NEWS2 numbers it compares with, and is honest that no Nigerian guideline was found and the older bands are the starting values", () => {
    const text = VITALS_CITATIONS.map((c) => c.label).join(" | ");
    expect(text).toMatch(/National Early Warning Score 2/);
    expect(text).toMatch(/131 or above/);
    expect(VITALS_CITATIONS.find((c) => c.id === "nigeria")?.tag).toBe("NV");
    expect(VITALS_CITATIONS.find((c) => c.id === "old-sql")?.tag).toBe("OLD");
  });

  it("says signing is the CMO's act and the older alerts keep running", () => {
    expect(VITALS_SIGNING_NOTE).toMatch(/Chief Medical Officer's own clinical act/);
    expect(VITALS_SIGNING_NOTE).toMatch(/never done for you/);
    expect(VITALS_SIGNING_NOTE).toMatch(/older alerts keep running/);
  });

  it("uses no em dash", () => {
    expect(JSON.stringify([VITALS_CITATIONS, VITALS_RULE_BASIS, VITALS_SIGNING_NOTE, VITALS_OPEN_POINTS])).not.toMatch(/—/);
  });

  it("shows the build's text only while the stored rules are exactly this build's", () => {
    expect(rulesMatchBuild(JSON.parse(JSON.stringify(VITALS_CARE_V1)))).toBe(true);
    const changed = JSON.parse(JSON.stringify(VITALS_CARE_V1));
    changed.params.pulse.emergencyAtOrAbove = 151;
    expect(rulesMatchBuild(changed)).toBe(false);
    expect(rulesMatchBuild(null)).toBe(false);
    expect(rulesMatchBuild("x")).toBe(false);
  });
});

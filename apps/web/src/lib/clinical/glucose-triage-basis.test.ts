import { describe, expect, it } from "@jest/globals";
import { GLUCOSE_CARE_V1 } from "@tarragon/clinical";
import { GLUCOSE_CITATIONS, GLUCOSE_OPEN_POINTS, GLUCOSE_RULE_BASIS, GLUCOSE_SIGNING_NOTE, rulesMatchBuild } from "./glucose-triage-basis";

describe("glucose triage guideline basis (CMO sign-off hub)", () => {
  it("has a basis for every rule of the rule set, and none for a rule that does not exist", () => {
    expect(Object.keys(GLUCOSE_RULE_BASIS).sort()).toEqual(GLUCOSE_CARE_V1.rules.map((r) => r.id).sort());
  });

  it("every citation a rule uses is defined, and the four named sources are all present", () => {
    const ids = new Set(GLUCOSE_CITATIONS.map((c) => c.id));
    for (const [rule, b] of Object.entries(GLUCOSE_RULE_BASIS)) {
      expect([rule, b.citations.length > 0]).toEqual([rule, true]);
      for (const c of b.citations) expect([rule, ids.has(c)]).toEqual([rule, true]);
    }
    const text = GLUCOSE_CITATIONS.map((c) => c.label).join(" | ");
    expect(text).toMatch(/ADA Standards of Care in Diabetes 2026, section 6/);
    expect(text).toMatch(/ADA\/EASD consensus report on hyperglycemic crises/);
    expect(text).toMatch(/ISPAD/);
    expect(text).toMatch(/NG-DM/);
  });

  it("is honest that only the draft of the Nigerian guideline could be opened", () => {
    const ng = GLUCOSE_CITATIONS.find((c) => c.id === "ng-dm");
    expect(ng?.tag).toBe("NV");
    expect(ng?.label).toMatch(/DRAFT/);
    expect(ng?.label).toMatch(/final 2021 text could NOT be/);
  });

  it("says signing is the CMO's act and nothing goes live on its own", () => {
    expect(GLUCOSE_SIGNING_NOTE).toMatch(/Chief Medical Officer's own clinical act/);
    expect(GLUCOSE_SIGNING_NOTE).toMatch(/never done for you/);
    expect(GLUCOSE_SIGNING_NOTE).toMatch(/older glucose alerts keep running/);
  });

  it("uses no em dash", () => {
    const all = JSON.stringify([GLUCOSE_CITATIONS, GLUCOSE_RULE_BASIS, GLUCOSE_SIGNING_NOTE, GLUCOSE_OPEN_POINTS]);
    expect(all).not.toMatch(/—/);
  });

  it("tells the CMO the open points that matter before signing: unsaved signs, late readings, and both pipelines paging", () => {
    const text = GLUCOSE_OPEN_POINTS.join(" ");
    expect(text).toMatch(/NOT yet stored on the server/);
    expect(text).toMatch(/Only manual and Bluetooth meter glucose readings/);
    expect(text).toMatch(/one decimal place/);
    expect(text).toMatch(/paged by BOTH/);
  });

  it("rulesMatchBuild is true only for exactly the bundled rule set (key order aside), so the CMO is never shown one version's reasoning beside another's Sign button", () => {
    const stored = JSON.parse(JSON.stringify(GLUCOSE_CARE_V1)) as Record<string, unknown>;
    expect(rulesMatchBuild(stored)).toBe(true);
    expect(rulesMatchBuild(Object.fromEntries(Object.entries(stored).reverse()))).toBe(true);
    expect(rulesMatchBuild({ ...stored, version: 2 })).toBe(false);
    const rules = (stored["rules"] as Array<Record<string, unknown>>).map((r, i) => (i === 0 ? { ...r, description: "changed" } : r));
    expect(rulesMatchBuild({ ...stored, rules })).toBe(false);
    expect(rulesMatchBuild(null)).toBe(false);
    expect(rulesMatchBuild(undefined)).toBe(false);
    expect(rulesMatchBuild("x")).toBe(false);
  });
});

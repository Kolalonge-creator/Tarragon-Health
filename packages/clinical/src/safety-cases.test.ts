import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { BP_CARE_V1, expectationWithDefaults, grade, summarise, type ResultSummary, type TriageInput } from "./index";

interface FixtureCase {
  id: string;
  title: string;
  safetyCase?: number;
  input: TriageInput;
  expect: Partial<ResultSummary>;
}
interface FixtureFile {
  ruleSet: { code: string; version: number };
  cases: FixtureCase[];
}

const fixtures: FixtureFile = JSON.parse(readFileSync(new URL("../fixtures/safety-cases.json", import.meta.url), "utf8"));

describe("clinical safety fixtures (spec 15.1)", () => {
  it("names the rule set it was written for", () => {
    expect(fixtures.ruleSet).toEqual({ code: BP_CARE_V1.code, version: BP_CARE_V1.version });
  });

  it("has unique ids and covers safety cases 1 to 7", () => {
    const ids = fixtures.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const covered = new Set(fixtures.cases.map((c) => c.safetyCase));
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(covered.has(n)).toBe(true);
  });

  it.each(fixtures.cases.map((c) => [c.id, c.title, c] as const))("%s: %s", (_id, _title, c) => {
    expect(summarise(grade(c.input, BP_CARE_V1))).toEqual(expectationWithDefaults(c.expect));
  });

  it("gives identical results when the rule set and input arrive as JSON (the device path)", () => {
    const deviceRules = JSON.parse(JSON.stringify(BP_CARE_V1)) as typeof BP_CARE_V1;
    for (const c of fixtures.cases) {
      const deviceInput = JSON.parse(JSON.stringify(c.input)) as TriageInput;
      expect(grade(deviceInput, deviceRules)).toEqual(grade(c.input, BP_CARE_V1));
    }
  });

  it("is deterministic: the same input twice gives the same result", () => {
    for (const c of fixtures.cases) expect(grade(c.input, BP_CARE_V1)).toEqual(grade(c.input, BP_CARE_V1));
  });

  it("every red result shows guidance and pages on-call (INV-05), and nothing else pages", () => {
    for (const c of fixtures.cases) {
      const r = grade(c.input, BP_CARE_V1);
      const kinds = r.actions.map((a) => a.kind);
      if (r.grade === "red") expect(kinds).toEqual(expect.arrayContaining(["show_emergency_guidance", "page_on_call"]));
      else expect(kinds).not.toContain("page_on_call");
    }
  });

  it("a recheck result never creates a task and never grades", () => {
    for (const c of fixtures.cases) {
      const r = grade(c.input, BP_CARE_V1);
      if (r.status === "recheck_required") {
        expect(r.grade).toBeNull();
        expect(r.actions.some((a) => a.kind === "create_task")).toBe(false);
      }
    }
  });

  it("a rejected result is never graded", () => {
    for (const c of fixtures.cases) {
      const r = grade(c.input, BP_CARE_V1);
      if (r.status === "rejected") expect(r.grade).toBeNull();
    }
  });

  it("every result names the rule set and version it used (INV-16)", () => {
    for (const c of fixtures.cases) expect(grade(c.input, BP_CARE_V1).ruleSet).toEqual({ code: "bp_care_triage", version: 2 });
  });
});

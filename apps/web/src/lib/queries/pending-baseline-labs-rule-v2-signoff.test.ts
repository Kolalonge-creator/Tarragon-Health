jest.mock("server-only", () => ({}));
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { baselineLabsRuleView } from "./pending-baseline-labs-rule-signoff";

/** The real v2 seed, so the panel is proven against what the CMO will actually be shown. */
function seed2(): Record<string, unknown> {
  const dir = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
  const file = readdirSync(dir).find((f) => f.endsWith("_baseline_labs_rule_v2_cmo_answers.sql"));
  if (!file) throw new Error("migration not found");
  const m = /baseline-labs-rule-v2-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(dir, file), "utf8"));
  if (!m?.[1]) throw new Error("seed not found");
  return JSON.parse(m[1]) as Record<string, unknown>;
}

describe("baselineLabsRuleView for version 2", () => {
  it("shows the tests for each medicine class, the 12-month window and the extra rules, straight from the draft", () => {
    const v = baselineLabsRuleView(seed2());
    expect(v).not.toBeNull();
    expect(v?.windowDays).toBe(365);
    const by = Object.fromEntries((v?.classRules ?? []).map((c) => [c.label, c.tests]));
    expect(by["ACE inhibitor or ARB"]).toBe("Kidney function (creatinine or eGFR), Potassium, Sodium");
    expect(by["Metformin"]).toBe("Kidney function (creatinine or eGFR), Fasting glucose or HbA1c");
    expect(v?.extraRules.join(" ")).toMatch(/under 30/);
    expect(v?.extraRules.join(" ")).toMatch(/pregnan/i);
    expect(v?.extraRules.join(" ")).toMatch(/unreliable/);
  });

  it("shows no calcium channel blocker or beta blocker among the covered medicines", () => {
    const v = baselineLabsRuleView(seed2());
    const all = (v?.groups ?? []).flatMap((g) => g.medicines);
    for (const d of ["amlodipine", "nifedipine", "atenolol", "metoprolol"]) expect(all).not.toContain(d);
    expect(all).toContain("losartan");
    expect(all).toContain("metformin");
  });

  it("returns null, so there is nothing to sign, when a class or an extra rule is malformed", () => {
    const s = seed2();
    expect(baselineLabsRuleView({ ...s, class_requirements: [{ label: 5, requires: [] }] })).toBeNull();
    expect(baselineLabsRuleView({ ...s, class_requirements: [{ label: "X", requires: ["no_such_test"] }] })).toBeNull();
    expect(baselineLabsRuleView({ ...s, egfr_rules: { do_not_start_below: 30 } })).toBeNull();
  });
});

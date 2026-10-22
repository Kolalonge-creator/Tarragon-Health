import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkInteractionRules, validateRuleSet, MAX_RULES_PER_SET, type IngredientRule } from "./interaction-rules";
import { RULE_SET_CASES } from "./interaction-rules.fixtures";

const rule = (over: Partial<IngredientRule> = {}): IngredientRule => ({
  code: "r1", ingredientA: "exampleone", ingredientB: "exampletwo", severity: "caution", source: "https://example.org/s", ...over,
});

describe("validateRuleSet (shared cases)", () => {
  for (const c of RULE_SET_CASES) {
    it(c.name, () => {
      expect(validateRuleSet(c.config).ok).toBe(c.valid);
    });
  }
  it("returns the rules, trimmed, when valid", () => {
    expect(validateRuleSet({ rules: [rule({ source: "  https://example.org/s  " })] })).toEqual({ ok: true, rules: [rule()] });
  });
  it("names the problems", () => {
    expect(validateRuleSet(null)).toEqual({ ok: false, errors: ["not_an_object"] });
    expect(validateRuleSet([])).toEqual({ ok: false, errors: ["not_an_object"] });
    expect(validateRuleSet({ rules: Array.from({ length: MAX_RULES_PER_SET + 1 }, () => rule()) })).toEqual({ ok: false, errors: ["too_many_rules"] });
    expect(validateRuleSet({ rules: [1] })).toEqual({ ok: false, errors: ["rule_not_an_object"] });
    expect(validateRuleSet({ rules: [rule({ code: 5 as unknown as string })] })).toEqual({ ok: false, errors: ["bad_code"] });
    expect(validateRuleSet({ rules: [rule(), rule()] })).toEqual({ ok: false, errors: ["duplicate_code"] });
    expect(validateRuleSet({ rules: [rule({ ingredientA: "" })] })).toEqual({ ok: false, errors: ["ingredient_not_normalised"] });
    expect(validateRuleSet({ rules: [rule({ ingredientB: 3 as unknown as string })] })).toEqual({ ok: false, errors: ["ingredient_not_normalised"] });
    expect(validateRuleSet({ rules: [rule({ ingredientB: "exampleone" })] })).toEqual({ ok: false, errors: ["same_ingredient"] });
    expect(validateRuleSet({ rules: [rule({ severity: 1 as unknown as "info" })] })).toEqual({ ok: false, errors: ["bad_severity"] });
    expect(validateRuleSet({ rules: [rule({ source: 9 as unknown as string })] })).toEqual({ ok: false, errors: ["source_missing"] });
  });
  it("is the same list the database proof checks", () => {
    const sql = readFileSync(resolve(process.cwd(), "../db/tests/s08y_medicine_safety.sql"), "utf8");
    for (const c of RULE_SET_CASES) expect(sql).toContain(`'${c.name}'`);
  });
});

describe("checkInteractionRules", () => {
  const items = [
    { id: "b", generic: "Exampletwo" },
    { id: "a", generic: "Exampleone and other" },
    { id: "c", generic: "Other" },
  ];
  it("fires for two different medicines and always only advises", () => {
    const r = checkInteractionRules([rule()], items);
    expect(r.findings).toEqual([{ ruleCode: "r1", severity: "caution", medicineIds: ["a", "b"], adviceKey: "medicines.rules.advice.review" }]);
    expect(r.isAdvisoryOnly).toBe(true);
    expect(r.changesAnything).toBe(false);
  });
  it("finds the pair whichever side holds which ingredient, and whatever the list order", () => {
    const flipped = rule({ ingredientA: "exampletwo", ingredientB: "exampleone" });
    expect(checkInteractionRules([flipped], [...items].reverse()).findings.map((f) => f.medicineIds)).toEqual([["a", "b"]]);
  });
  it("does not fire for one combination product holding both, or with no rules", () => {
    expect(checkInteractionRules([rule()], [{ id: "x", generic: "Exampleone and exampletwo" }]).findings).toEqual([]);
    expect(checkInteractionRules([], items).findings).toEqual([]);
  });
  it("filters to the medicine being added and lists the worst first, then by code", () => {
    const rules = [
      rule({ code: "z_note", severity: "info" }),
      rule({ code: "b_high", severity: "contraindicated" }),
      rule({ code: "a_high", severity: "contraindicated", ingredientA: "other", ingredientB: "exampletwo" }),
    ];
    const all = checkInteractionRules(rules, items);
    expect(all.findings.map((f) => `${f.ruleCode}:${f.adviceKey.split(".").pop()}`)).toEqual(["a_high:high", "a_high:high", "b_high:high", "z_note:note"]);
    expect(checkInteractionRules(rules, items, "c").findings.map((f) => f.ruleCode)).toEqual(["a_high"]);
    expect(checkInteractionRules(rules, items, "nobody").findings).toEqual([]);
  });
  it("lists a rule once per pair even when both sides could match", () => {
    const both = [{ id: "a", generic: "Exampleone and exampletwo" }, { id: "b", generic: "Exampleone and exampletwo" }];
    expect(checkInteractionRules([rule()], both).findings).toHaveLength(1);
  });
});

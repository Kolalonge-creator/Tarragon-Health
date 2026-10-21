/**
 * Shared cases for the rule-set shape check. `validateRuleSet` runs them in `interaction-rules.test.ts`; the database proof runs
 * the same configs through `private.interaction_rules_valid`, and a test fails if a case name here is missing from that proof.
 *
 * The ingredient names are deliberately fictional ("exampleone"). They are structure tests, not interactions: this repository
 * does not author clinical rules, and no real pair of medicines appears here.
 */
export interface RuleSetCase {
  name: string;
  config: unknown;
  valid: boolean;
}

const good = { code: "example_rule", ingredientA: "exampleone", ingredientB: "exampletwo", severity: "caution", source: "https://example.org/source" };

export const RULE_SET_CASES: RuleSetCase[] = [
  { name: "an empty set is valid (how the table is born)", config: { rules: [] }, valid: true },
  { name: "one well-formed rule", config: { rules: [good] }, valid: true },
  { name: "rules is not a list", config: { rules: "none" }, valid: false },
  { name: "no rules key", config: {}, valid: false },
  { name: "a rule without a source", config: { rules: [{ ...good, source: "" }] }, valid: false },
  { name: "a source that is not a link", config: { rules: [{ ...good, source: "the pharmacist said so" }] }, valid: false },
  { name: "an unknown severity", config: { rules: [{ ...good, severity: "severe" }] }, valid: false },
  { name: "an ingredient that is not normalised", config: { rules: [{ ...good, ingredientA: "Example One" }] }, valid: false },
  { name: "the same ingredient on both sides", config: { rules: [{ ...good, ingredientB: "exampleone" }] }, valid: false },
  { name: "a repeated rule code", config: { rules: [good, { ...good, ingredientB: "examplethree" }] }, valid: false },
  { name: "a bad rule code", config: { rules: [{ ...good, code: "Bad Code" }] }, valid: false },
];

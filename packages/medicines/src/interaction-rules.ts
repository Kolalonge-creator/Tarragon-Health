import { normaliseIngredient, splitIngredients, type IngredientItem } from "./ingredients";

/**
 * Governed interaction rules (S08y, item 2).
 *
 * A rule says: when a person takes a medicine containing ingredient A and a different medicine containing ingredient B, show
 * a fixed, reviewed sentence by severity. The rules live in `medicine_interaction_rule_sets`, a versioned table that is born
 * EMPTY, unsigned and inactive; only the active Chief Medical Officer can sign a version, and a pharmacist reviews it first.
 * Nothing in this repository authors a rule: no clinical content is seeded, so until a human writes and signs a set there is
 * nothing to match, and the check says nothing.
 *
 * WARN ONLY. The result carries `isAdvisoryOnly: true` and `changesAnything: false`; it cannot stop, remove or edit a medicine,
 * and the patient sentences (packages/i18n `medicines.rules.advice.*`) say "your care team" and never "stop". No model is
 * involved (INV-01); matching is plain string comparison of normalised ingredient names, order independent.
 *
 * `validateRuleSet` is mirrored by `private.interaction_rules_valid` in the database (a CHECK on the table), and both run the
 * cases in `interaction-rules.fixtures.ts`.
 */
export type RuleSeverity = "contraindicated" | "caution" | "info";

export const RULE_SEVERITIES: readonly RuleSeverity[] = ["contraindicated", "caution", "info"];

export interface IngredientRule {
  /** Short stable code, lower case letters, digits and underscores. */
  code: string;
  /** Normalised ingredient names (see `normaliseIngredient`). Different from each other. */
  ingredientA: string;
  ingredientB: string;
  severity: RuleSeverity;
  /** A public source the reviewer can check. Required: a rule nobody can trace does not go live. */
  source: string;
}

export interface InteractionRuleSetConfig {
  rules: IngredientRule[];
}

export type RuleSetError =
  | "not_an_object"
  | "rules_not_a_list"
  | "too_many_rules"
  | "rule_not_an_object"
  | "bad_code"
  | "duplicate_code"
  | "ingredient_not_normalised"
  | "same_ingredient"
  | "bad_severity"
  | "source_missing";

export type RuleSetCheck = { ok: true; rules: IngredientRule[] } | { ok: false; errors: RuleSetError[] };

export const MAX_RULES_PER_SET = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Is this config a well-formed rule set? An empty list is valid: that is how the table is born. */
export function validateRuleSet(config: unknown): RuleSetCheck {
  if (!isRecord(config)) return { ok: false, errors: ["not_an_object"] };
  const list = config["rules"];
  if (!Array.isArray(list)) return { ok: false, errors: ["rules_not_a_list"] };
  if (list.length > MAX_RULES_PER_SET) return { ok: false, errors: ["too_many_rules"] };
  const errors = new Set<RuleSetError>();
  const codes = new Set<string>();
  const rules: IngredientRule[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) {
      errors.add("rule_not_an_object");
      continue;
    }
    const code = raw["code"];
    const a = raw["ingredientA"];
    const b = raw["ingredientB"];
    const severity = raw["severity"];
    const source = raw["source"];
    if (typeof code !== "string" || !/^[a-z0-9_]{1,60}$/.test(code)) errors.add("bad_code");
    else if (codes.has(code)) errors.add("duplicate_code");
    else codes.add(code);
    const aOk = typeof a === "string" && a.length > 0 && a === normaliseIngredient(a);
    const bOk = typeof b === "string" && b.length > 0 && b === normaliseIngredient(b);
    if (!aOk || !bOk) errors.add("ingredient_not_normalised");
    else if (a === b) errors.add("same_ingredient");
    if (typeof severity !== "string" || !(RULE_SEVERITIES as readonly string[]).includes(severity)) errors.add("bad_severity");
    if (typeof source !== "string" || source.trim().length < 5) errors.add("source_missing");
    if (errors.size === 0) {
      rules.push({ code: code as string, ingredientA: a as string, ingredientB: b as string, severity: severity as RuleSeverity, source: (source as string).trim() });
    }
  }
  return errors.size > 0 ? { ok: false, errors: [...errors] } : { ok: true, rules };
}

export type RuleAdviceKey = "medicines.rules.advice.high" | "medicines.rules.advice.review" | "medicines.rules.advice.note";

const ADVICE: Record<RuleSeverity, RuleAdviceKey> = {
  contraindicated: "medicines.rules.advice.high",
  caution: "medicines.rules.advice.review",
  info: "medicines.rules.advice.note",
};

const RANK: Record<RuleSeverity, number> = { contraindicated: 0, caution: 1, info: 2 };

export interface RuleFinding {
  ruleCode: string;
  severity: RuleSeverity;
  /** The two medicine ids, in plain code-unit order. */
  medicineIds: [string, string];
  adviceKey: RuleAdviceKey;
}

export interface RuleCheckResult {
  findings: RuleFinding[];
  /** Always true: the check only advises. */
  isAdvisoryOnly: true;
  /** Always false: nothing here stops or changes a medicine. */
  changesAnything: false;
}

/**
 * Match a signed rule set against the medicines a person takes. A rule fires for two DIFFERENT medicines, one holding each
 * ingredient; a single combination product that holds both does not fire. With `involving`, only findings that involve that
 * medicine id are returned (the add form asks about the new medicine). Sorted by severity, then rule code, then ids.
 */
export function checkInteractionRules(
  rules: readonly IngredientRule[],
  items: readonly IngredientItem[],
  involving?: string,
): RuleCheckResult {
  const prepared = items.map((i) => ({ id: i.id, set: new Set(splitIngredients(i.generic)) }));
  const seen = new Set<string>();
  const findings: RuleFinding[] = [];
  for (const rule of rules) {
    for (const x of prepared) {
      for (const y of prepared) {
        if (x.id === y.id || !x.set.has(rule.ingredientA) || !y.set.has(rule.ingredientB)) continue;
        const pair: [string, string] = x.id < y.id ? [x.id, y.id] : [y.id, x.id];
        if (involving !== undefined && !pair.includes(involving)) continue;
        const key = `${rule.code}|${pair[0]}|${pair[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ ruleCode: rule.code, severity: rule.severity, medicineIds: pair, adviceKey: ADVICE[rule.severity] });
      }
    }
  }
  const sortKey = (f: RuleFinding) => `${RANK[f.severity]}|${f.ruleCode}|${f.medicineIds[0]}|${f.medicineIds[1]}`;
  findings.sort((p, q) => (sortKey(p) < sortKey(q) ? -1 : 1));
  return { findings, isAdvisoryOnly: true, changesAnything: false };
}

import type { Predicate } from "@/lib/rules/predicate";
import type {
  ClinicalRuleRow,
  ParsedClinicalRule,
  RuleActionDefinition,
  RuleConditions,
  RuleEscalationConfig,
  RuleSuppressionConfig,
} from "./types";

/**
 * Parses a raw clinical_rules row's jsonb columns into typed shapes.
 *
 * The DB only guarantees `jsonb_typeof(...) = 'object'/'array'` (see the
 * CHECK constraints in the rule_definitions migration) — it does not, and
 * cannot cheaply, validate the full nested shape. This parser is therefore
 * the actual gate: a malformed rule (hand-edited jsonb, a future schema
 * version this code doesn't know about) is rejected here with a clear
 * error rather than silently misbehaving mid-evaluation. Fail loud at parse
 * time, not fail quiet at evaluation time.
 */
export function parseClinicalRule(row: ClinicalRuleRow): ParsedClinicalRule {
  const population = asPredicate(row.population, `${row.rule_key} v${row.version} population`);
  const conditions = asConditions(row.conditions, `${row.rule_key} v${row.version} conditions`);
  const actions = asActions(row.actions, `${row.rule_key} v${row.version} actions`);
  const escalation = (row.escalation ?? {}) as RuleEscalationConfig;
  const suppression = (row.suppression ?? {}) as RuleSuppressionConfig;

  return {
    ...row,
    population,
    conditions,
    actions,
    escalation,
    suppression,
  };
}

function asPredicate(value: unknown, label: string): Predicate {
  if (value === null || value === undefined) return { op: "true" };
  if (typeof value !== "object" || Array.isArray(value) || !("op" in (value as object))) {
    throw new Error(`${label}: expected a predicate object with an "op" field`);
  }
  return value as Predicate;
}

function asConditions(value: unknown, label: string): RuleConditions {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: expected an object`);
  }
  const obj = value as Record<string, unknown>;
  const result: RuleConditions = {};
  if (obj.predicate !== undefined) {
    result.predicate = asPredicate(obj.predicate, `${label}.predicate`);
  }
  if (obj.window !== undefined) {
    const w = obj.window as Record<string, unknown>;
    if (
      typeof w !== "object" ||
      typeof w.metric !== "string" ||
      typeof w.comparator !== "string" ||
      typeof w.threshold !== "number" ||
      typeof w.days !== "number"
    ) {
      throw new Error(`${label}.window: expected {metric, comparator, threshold, days, ...}`);
    }
    result.window = w as unknown as RuleConditions["window"];
  }
  return result;
}

function asActions(value: unknown, label: string): RuleActionDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: expected an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${label}[${index}]: expected an object`);
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.action_type !== "string") {
      throw new Error(`${label}[${index}]: missing action_type`);
    }
    return {
      action_type: obj.action_type as RuleActionDefinition["action_type"],
      payload: (obj.payload as Record<string, unknown>) ?? {},
      requires_clinician_oversight:
        typeof obj.requires_clinician_oversight === "boolean" ? obj.requires_clinician_oversight : undefined,
    };
  });
}

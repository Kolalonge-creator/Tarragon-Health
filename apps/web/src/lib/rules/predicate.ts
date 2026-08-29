/**
 * Safe, declarative predicate DSL shared by the configurable risk
 * questionnaire engine (risk-questionnaire-engine.ts) and prevention
 * campaign eligibility (lib/prevention-campaigns/eligibility.ts). Stored as
 * plain jsonb in risk_questionnaire_configs.config and
 * prevention_campaigns.eligibility_rule — never a code string, never `eval`
 * or `new Function`, so a signed-off clinical config can never smuggle
 * arbitrary code execution into the app process.
 *
 * A predicate is evaluated against a flat context object — questionnaire
 * responses keyed by question_key, merged with derived profile fields
 * (sex, ageYears, bmi, ...). Missing/null fields are conservative: every
 * comparison op treats a missing field as "does not match" rather than
 * throwing or defaulting to true, so a malformed or incomplete context
 * never accidentally satisfies a clinical rule.
 */

export type Predicate =
  | { op: "true" }
  | { op: "false" }
  | { op: "eq"; field: string; value: unknown }
  | { op: "neq"; field: string; value: unknown }
  | { op: "in"; field: string; value: unknown[] }
  | { op: "includes"; field: string; value: unknown }
  | { op: "gte"; field: string; value: number }
  | { op: "lte"; field: string; value: number }
  | { op: "gt"; field: string; value: number }
  | { op: "lt"; field: string; value: number }
  | { op: "and"; clauses: Predicate[] }
  | { op: "or"; clauses: Predicate[] }
  | { op: "not"; clause: Predicate };

export type PredicateContext = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Evaluates a predicate against a context. Never throws — an unrecognised
 * op (e.g. a future DSL version read by older code) resolves to false, the
 * same fail-closed stance as a missing field, since a clinical eligibility
 * or scoring rule should never silently pass on data it doesn't understand.
 */
export function evaluatePredicate(predicate: Predicate, context: PredicateContext): boolean {
  switch (predicate.op) {
    case "true":
      return true;
    case "false":
      return false;
    case "eq": {
      const actual = context[predicate.field];
      return actual !== undefined && actual !== null && actual === predicate.value;
    }
    case "neq": {
      const actual = context[predicate.field];
      return actual !== undefined && actual !== null && actual !== predicate.value;
    }
    case "in": {
      const actual = context[predicate.field];
      return actual !== undefined && actual !== null && predicate.value.includes(actual);
    }
    case "includes": {
      const actual = context[predicate.field];
      return Array.isArray(actual) && actual.includes(predicate.value);
    }
    case "gte": {
      const actual = asNumber(context[predicate.field]);
      return actual !== null && actual >= predicate.value;
    }
    case "lte": {
      const actual = asNumber(context[predicate.field]);
      return actual !== null && actual <= predicate.value;
    }
    case "gt": {
      const actual = asNumber(context[predicate.field]);
      return actual !== null && actual > predicate.value;
    }
    case "lt": {
      const actual = asNumber(context[predicate.field]);
      return actual !== null && actual < predicate.value;
    }
    case "and":
      return predicate.clauses.every((clause) => evaluatePredicate(clause, context));
    case "or":
      return predicate.clauses.some((clause) => evaluatePredicate(clause, context));
    case "not":
      return !evaluatePredicate(predicate.clause, context);
    default:
      return false;
  }
}

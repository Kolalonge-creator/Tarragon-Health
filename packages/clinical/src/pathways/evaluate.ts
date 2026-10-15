import type { Operand, PathwayCondition, PathwayFactValue, PathwayFacts, PathwayRuleSet } from "./types";

function resolve(operand: Operand, params: PathwayRuleSet["params"]): number | string | boolean | null {
  if (typeof operand !== "object") return operand;
  if (!operand.ref.startsWith("params.")) return null;
  const v = params[operand.ref.slice("params.".length)];
  return typeof v === "number" ? v : null;
}

function compare(left: PathwayFactValue | undefined, op: string, right: number | string | boolean | null): boolean {
  if (left === undefined) return false;
  if (op === "eq") return left === right;
  if (op === "neq") return left !== right;
  // an ordering comparison against a missing value is false, so a rule can never fire on data that is not there
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (op === "gte") return left >= right;
  if (op === "gt") return left > right;
  if (op === "lte") return left <= right;
  return left < right;
}

/** Evaluates one rule condition against flat facts. Missing or null facts never satisfy an ordering comparison. */
export function evaluateCondition(cond: PathwayCondition, facts: PathwayFacts, params: PathwayRuleSet["params"]): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluateCondition(c, facts, params));
  if ("any" in cond) return cond.any.some((c) => evaluateCondition(c, facts, params));
  if ("not" in cond) return !evaluateCondition(cond.not, facts, params);
  return compare(facts[cond.field], cond.op, resolve(cond.value, params));
}

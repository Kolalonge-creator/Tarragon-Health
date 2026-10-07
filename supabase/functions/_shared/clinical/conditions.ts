import type { Context, ContextValue } from "./context.ts";
import type { Condition, Operand, RuleSet, SymptomCode } from "./types.ts";

export interface EvalEnv {
  readonly ctx: Context;
  readonly params: Readonly<Record<string, number>>;
  readonly groups: RuleSet["params"]["symptomGroups"];
  readonly symptoms: ReadonlySet<SymptomCode>;
}

function resolve(operand: Operand, env: EvalEnv): number | string | boolean | null {
  if (typeof operand !== "object") return operand;
  const base = operand.ref.startsWith("params.") ? env.params[operand.ref] : env.ctx[operand.ref];
  return typeof base === "number" ? base + (operand.add ?? 0) : null;
}

function compare(left: ContextValue, op: string, right: number | string | boolean | null): boolean {
  if (op === "eq") return left === right;
  if (op === "neq") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (op === "gte") return left >= right;
  if (op === "gt") return left > right;
  if (op === "lte") return left <= right;
  return left < right;
}

/**
 * Evaluates one rule condition. A comparison against a missing value (null) is
 * false for every ordering operator, so a rule can never fire on data that is
 * not there.
 */
export function evaluate(cond: Condition, env: EvalEnv): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluate(c, env));
  if ("any" in cond) return cond.any.some((c) => evaluate(c, env));
  if ("not" in cond) return !evaluate(cond.not, env);
  if ("symptomGroup" in cond) return (env.groups[cond.symptomGroup] as readonly string[]).some((s) => env.symptoms.has(s as SymptomCode));
  return compare(env.ctx[cond.field] as ContextValue, cond.op, resolve(cond.value, env));
}

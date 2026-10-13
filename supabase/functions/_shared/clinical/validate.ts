import { CONTEXT_FIELDS, flattenParams } from "./context.ts";
import { isValidTimestamp } from "./dates.ts";
import type { RejectReason, RuleSet, TriageInput } from "./types.ts";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type ReadingCheck = "ok" | "invalid_input" | "implausible_reading";

function checkReading(r: unknown, v: RuleSet["params"]["validation"]): ReadingCheck {
  if (!isObj(r) || !isNum(r.systolic) || !isNum(r.diastolic) || !isValidTimestamp(r.takenAt)) return "invalid_input";
  if (r.systolic < v.systolicMin || r.systolic > v.systolicMax) return "implausible_reading";
  if (r.diastolic < v.diastolicMin || r.diastolic > v.diastolicMax) return "implausible_reading";
  return r.diastolic > r.systolic ? "implausible_reading" : "ok";
}

/**
 * Input validation that runs before any grading (spec 6.2): a reading outside
 * the plausible range, or a diastolic above the systolic, is rejected and never
 * graded. Anything malformed is `invalid_input`. Returns null when the input is
 * fit to grade.
 */
export function validateInput(input: TriageInput, ruleSet: RuleSet): RejectReason | null {
  const t = input.trigger as unknown;
  if (!isObj(t) || !isValidTimestamp(input.now)) return "invalid_input";
  if (!isNum(input.target?.systolic) || !isNum(input.target?.diastolic)) return "invalid_input";
  if (input.target.systolic <= 0 || input.target.diastolic <= 0) return "invalid_input";
  if (!Array.isArray(input.history) || typeof input.pregnant !== "boolean") return "invalid_input";
  if (input.postpartum !== undefined && typeof input.postpartum !== "boolean") return "invalid_input";
  if (!isObj(input.pathway) || typeof input.pathway.state !== "string") return "invalid_input";
  if (input.ageYears !== null && !isNum(input.ageYears)) return "invalid_input";
  if (t.type === "observation") {
    const check = checkReading(t.reading, ruleSet.params.validation);
    if (check !== "ok") return check;
    if (!Array.isArray(t.symptoms)) return "invalid_input";
    if (t.symptomsAnswered !== undefined && typeof t.symptomsAnswered !== "boolean") return "invalid_input";
    const recheck = t.recheck;
    if (recheck === undefined) return null;
    if (!isObj(recheck)) return "invalid_input";
    if (recheck.kind === "timed_out") return null;
    if (recheck.kind !== "repeat" || !isNum(recheck.minutesSincePrevious) || recheck.minutesSincePrevious < 0) {
      return "invalid_input";
    }
    return checkReading(recheck.previous, ruleSet.params.validation) === "ok" ? null : "invalid_input";
  }
  if (t.type === "adherence") {
    return t.percent7d === null || (isNum(t.percent7d) && t.percent7d >= 0 && t.percent7d <= 100) ? null : "invalid_input";
  }
  if (t.type === "silence") {
    const lastOk = t.lastReadingAt === null || isValidTimestamp(t.lastReadingAt);
    return lastOk && isValidTimestamp(t.sinceAt) ? null : "invalid_input";
  }
  return "invalid_input";
}

const CMP_OPS = ["gte", "gt", "lte", "lt", "eq", "neq"];
const TRIGGERS = ["observation", "adherence", "silence"];
const ANCHORS = ["reading", "week", "lastReadingDate"];
const ACTION_KINDS = ["show_emergency_guidance", "page_on_call", "show_message", "prompt_recheck", "ask_symptoms", "route_referral", "create_task"];

function conditionErrors(cond: unknown, at: string, rs: Record<string, unknown>, known: ReadonlySet<string>): string[] {
  if (!isObj(cond)) return [`${at}: condition must be an object`];
  if ("all" in cond || "any" in cond) {
    const list = cond.all ?? cond.any;
    if (!Array.isArray(list) || list.length === 0) return [`${at}: all/any needs a non-empty list`];
    return list.flatMap((c, i) => conditionErrors(c, `${at}[${i}]`, rs, known));
  }
  if ("not" in cond) return conditionErrors(cond.not, `${at}.not`, rs, known);
  if ("symptomGroup" in cond) {
    const groups = (rs.params as { symptomGroups: Record<string, unknown> }).symptomGroups;
    const ok = typeof cond.symptomGroup === "string" && Object.hasOwn(groups, cond.symptomGroup) && Array.isArray(groups[cond.symptomGroup]);
    return ok ? [] : [`${at}: unknown symptom group`];
  }
  const errors: string[] = [];
  if (typeof cond.field !== "string" || !known.has(cond.field)) errors.push(`${at}: unknown field ${String(cond.field)}`);
  if (typeof cond.op !== "string" || !CMP_OPS.includes(cond.op)) errors.push(`${at}: bad operator`);
  const v = cond.value;
  if (isObj(v)) {
    if (typeof v.ref !== "string" || !known.has(v.ref)) errors.push(`${at}: unknown ref ${String(v.ref)}`);
    if (v.add !== undefined && !isNum(v.add)) errors.push(`${at}: add must be a number`);
  } else if (!["number", "string", "boolean"].includes(typeof v)) errors.push(`${at}: bad value`);
  return errors;
}

function actionErrors(action: unknown, at: string): string[] {
  if (!isObj(action) || typeof action.kind !== "string" || !ACTION_KINDS.includes(action.kind)) return [`${at}: bad action`];
  if (action.kind === "create_task") {
    const ok =
      typeof action.task === "string" &&
      typeof action.notifyKey === "string" &&
      Number.isInteger(action.dueMinutes) &&
      (action.dueMinutes as number) > 0;
    return ok ? [] : [`${at}: create_task needs task, notifyKey and a positive whole dueMinutes`];
  }
  return [];
}

/**
 * Structural validation of a rule set. A rule set that fails here is never
 * applied: the engine returns `invalid_rule_set` instead of grading with half a
 * rule set. It also enforces the invariants the spec puts on rule content:
 * every red rule carries both the emergency guidance and the on-call page
 * (INV-05), and every rule that creates a task says which cause its key is
 * anchored on, so a daily check cannot pile up duplicates.
 */
export function validateRuleSet(value: unknown): string[] {
  if (!isObj(value)) return ["rule set must be an object"];
  const errors: string[] = [];
  if (typeof value.code !== "string" || value.code === "") errors.push("code is required");
  if (!Number.isInteger(value.version) || (value.version as number) < 1) errors.push("version must be a whole number from 1");
  if (!isObj(value.params)) return [...errors, "params is required"];
  const p = value.params;
  const v = p.validation;
  if (!isObj(v) || ![v.systolicMin, v.systolicMax, v.diastolicMin, v.diastolicMax].every(isNum)) {
    errors.push("params.validation needs four numbers");
  }
  for (const name of ["recheck", "extremeRecheck"] as const) {
    const rc = p[name];
    if (!isObj(rc) || !isNum(rc.afterMinutes) || !isNum(rc.windowMinutes) || rc.windowMinutes < rc.afterMinutes) {
      errors.push(`params.${name} needs afterMinutes and a windowMinutes that is not shorter`);
    }
  }
  if (!isNum(p.averageWindowDays) || p.averageWindowDays <= 0) errors.push("params.averageWindowDays must be positive");
  if (!isObj(p.symptomGroups) || !Array.isArray(p.symptomGroups.redFlag)) {
    errors.push("params.symptomGroups must be an object with a redFlag list");
  }
  const rj = p.rejected;
  if (!isObj(rj) || typeof rj.explanationKey !== "string" || typeof rj.redFlagGuidanceCode !== "string") {
    errors.push("params.rejected needs explanationKey and redFlagGuidanceCode");
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0) return [...errors, "rules must be a non-empty list"];
  if (errors.length > 0) return errors;

  const known = new Set<string>([...CONTEXT_FIELDS, ...Object.keys(flattenParams(p))]);
  const seen = new Set<string>();
  value.rules.forEach((rule: unknown, i: number) => {
    const at = `rules[${i}]`;
    if (!isObj(rule)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (typeof rule.id !== "string" || rule.id === "") errors.push(`${at}: id is required`);
    else if (seen.has(rule.id)) errors.push(`${at}: duplicate id ${rule.id}`);
    else seen.add(rule.id);
    if (!Array.isArray(rule.triggers) || rule.triggers.length === 0 || !rule.triggers.every((t) => TRIGGERS.includes(t))) {
      errors.push(`${at}: triggers must list observation, adherence or silence`);
    }
    if (typeof rule.explanationKey !== "string" || rule.explanationKey === "") errors.push(`${at}: explanationKey is required`);
    const isGrade = rule.result === "grade";
    if (!isGrade && rule.result !== "recheck" && rule.result !== "ask") errors.push(`${at}: result must be grade, recheck or ask`);
    if (rule.recheckTiming !== undefined && rule.recheckTiming !== "standard" && rule.recheckTiming !== "extreme") {
      errors.push(`${at}: recheckTiming must be standard or extreme`);
    }
    if (isGrade && !["green", "amber", "red"].includes(rule.grade as string)) errors.push(`${at}: grade must be green, amber or red`);
    if (!Array.isArray(rule.actions)) errors.push(`${at}: actions must be a list`);
    else {
      rule.actions.forEach((a, j) => errors.push(...actionErrors(a, `${at}.actions[${j}]`)));
      const kinds = rule.actions.map((a) => (isObj(a) ? a.kind : undefined));
      if (rule.grade === "red" && !(kinds.includes("page_on_call") && kinds.includes("show_emergency_guidance"))) {
        errors.push(`${at}: a red rule must show emergency guidance and page on-call (INV-05)`);
      }
      if (kinds.includes("create_task")) {
        const only = (t: string) => Array.isArray(rule.triggers) && rule.triggers.length === 1 && rule.triggers[0] === t;
        const anchorOk =
          ANCHORS.includes(rule.taskAnchor as string) &&
          (rule.taskAnchor !== "reading" || only("observation")) &&
          (rule.taskAnchor !== "lastReadingDate" || only("silence"));
        if (!anchorOk) errors.push(`${at}: a task rule needs a taskAnchor that fits its trigger`);
      }
    }
    errors.push(...conditionErrors(rule.when, `${at}.when`, value, known));
  });
  return errors;
}

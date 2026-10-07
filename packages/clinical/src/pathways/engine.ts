import { evaluateCondition } from "./evaluate";
import type { PathwayAction, PathwayInput, PathwayResult, PathwayRule, PathwayRuleSet } from "./types";

const OPS = ["gte", "gt", "lte", "lt", "eq", "neq"];
const GRADES = ["green", "amber", "red"];
const STATUSES = ["draft", "approved", "retired"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function conditionProblems(c: unknown, at: string, out: string[]): void {
  if (!isObj(c)) return void out.push(`${at}: condition must be an object`);
  if ("all" in c || "any" in c) {
    const list = (c.all ?? c.any) as unknown;
    if (!Array.isArray(list) || list.length === 0) return void out.push(`${at}: all/any needs a non-empty list`);
    list.forEach((x, i) => conditionProblems(x, `${at}[${i}]`, out));
    return;
  }
  if ("not" in c) return conditionProblems(c.not, `${at}.not`, out);
  if (typeof c.field !== "string" || c.field === "") out.push(`${at}: field is required`);
  if (typeof c.op !== "string" || !OPS.includes(c.op)) out.push(`${at}: unknown operator`);
  const v = c.value;
  const okValue = ["number", "string", "boolean"].includes(typeof v) || (isObj(v) && typeof v.ref === "string");
  if (!okValue) out.push(`${at}: value must be a literal or a ref`);
}

/** Structural validation of a rule set. An invalid rule set is refused whole; the caller falls back to the bundled one. */
export function validatePathwayRuleSet(rs: unknown): string[] {
  const out: string[] = [];
  if (!isObj(rs)) return ["rule set must be an object"];
  if (typeof rs.code !== "string" || !/^[a-z][a-z0-9_]*$/.test(rs.code)) out.push("code is required");
  if (!Number.isInteger(rs.version) || (rs.version as number) < 1) out.push("version must be a positive whole number");
  if (typeof rs.status !== "string" || !STATUSES.includes(rs.status)) out.push("status must be draft, approved or retired");
  if (!isObj(rs.params) || Object.values(rs.params).some((v) => typeof v !== "number" || !Number.isFinite(v))) out.push("params must be numbers");
  if (!Array.isArray(rs.rules) || rs.rules.length === 0) return [...out, "rules must be a non-empty list"];
  const seen = new Set<string>();
  const params = isObj(rs.params) ? rs.params : {};
  (rs.rules as unknown[]).forEach((r, i) => {
    const at = `rules[${i}]`;
    if (!isObj(r)) return void out.push(`${at} must be an object`);
    if (typeof r.id !== "string" || r.id === "") out.push(`${at}.id is required`);
    else if (seen.has(r.id)) out.push(`${at}.id is a duplicate`);
    else seen.add(r.id);
    if (typeof r.grade !== "string" || !GRADES.includes(r.grade)) out.push(`${at}.grade must be green, amber or red`);
    if (typeof r.explanationKey !== "string" || r.explanationKey === "") out.push(`${at}.explanationKey is required`);
    conditionProblems(r.when, `${at}.when`, out);
    JSON.stringify(r.when, (_k, v: unknown) => {
      if (isObj(v) && typeof v.ref === "string" && !(v.ref.startsWith("params.") && v.ref.slice(7) in params)) out.push(`${at}: unknown ref ${v.ref}`);
      return v;
    });
    const actions = Array.isArray(r.actions) ? (r.actions as PathwayAction[]) : null;
    if (actions === null) return void out.push(`${at}.actions must be a list`);
    if (actions.some((a) => a.kind === "create_task") && r.taskAnchor !== "reading" && r.taskAnchor !== "week") out.push(`${at}: a rule that creates a task needs a taskAnchor`);
    if (r.grade === "red" && !actions.some((a) => a.kind === "page_on_call")) out.push(`${at}: a red rule must page on call (INV-05)`);
  });
  return out;
}

/** ISO week key (YYYY-Www) in Africa/Lagos (UTC+1, no DST). */
function weekKey(iso: string): string {
  const d = new Date(Date.parse(iso) + 3_600_000);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const anchorOf = (rule: PathwayRule, input: PathwayInput): string => (rule.taskAnchor === "reading" ? input.readingAt : weekKey(input.now));

const BASE = { grade: null, ruleId: null, explanationKey: null, actions: [], matchedRuleIds: [], taskKey: null, duplicateSuppressed: false } as const;

/**
 * Grades one pathway observation. The first red wins, else the first amber, else the first green (rule order breaks ties), so an extra
 * matching rule can only ever raise urgency. Nothing matching is a green with no rule: the engine never reassures (no explanation key).
 */
export function gradePathway(input: PathwayInput, ruleSet: PathwayRuleSet): PathwayResult {
  if (validatePathwayRuleSet(ruleSet).length > 0) {
    return { ...BASE, status: "rejected", reason: "invalid_rule_set", ruleSet: { code: "invalid", version: 0 } };
  }
  const id = { code: ruleSet.code, version: ruleSet.version };
  if (Number.isNaN(Date.parse(input.readingAt)) || Number.isNaN(Date.parse(input.now))) {
    return { ...BASE, status: "rejected", reason: "invalid_input", ruleSet: id };
  }
  const matched = ruleSet.rules.filter((r) => evaluateCondition(r.when, input.facts, ruleSet.params));
  const winner = matched.find((r) => r.grade === "red") ?? matched.find((r) => r.grade === "amber") ?? matched.find((r) => r.grade === "green");
  let actions: readonly PathwayAction[] = winner?.actions ?? [];
  let taskKey: string | null = null;
  let duplicateSuppressed = false;
  if (winner && actions.some((a) => a.kind === "create_task")) {
    taskKey = `${winner.id}:${anchorOf(winner, input)}`;
    if (input.existingOpenTaskKeys?.includes(taskKey)) {
      actions = actions.filter((a) => a.kind !== "create_task");
      duplicateSuppressed = true;
    }
  }
  return {
    status: "graded",
    grade: winner?.grade ?? "green",
    ruleId: winner?.id ?? null,
    explanationKey: winner?.explanationKey ?? null,
    actions,
    matchedRuleIds: matched.map((r) => r.id),
    taskKey,
    duplicateSuppressed,
    reason: null,
    ruleSet: id,
  };
}

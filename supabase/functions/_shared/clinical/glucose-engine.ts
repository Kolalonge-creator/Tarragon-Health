// S11 follow-on (plan item R2, CMO decisions Q6 to Q9): the glucose half of the triage engine.
//
// It is the SAME engine in every way that matters: the same declarative condition language and evaluator (conditions.ts),
// the same action vocabulary, the same result shape and summary (so the same fixture format and the same phone/server
// parity test), the same rule semantics (rules run in file order, the first red wins, otherwise the highest grade, earliest
// rule on a tie), the same structural rule validation (conditionErrors, actionErrors, INV-05 on every red) and the same
// reject-before-grading input validation. What differs is only the facts a glucose reading brings (glucose, context,
// ketones, symptoms, diabetes type, age, pregnancy), so its input, context and parameter types are its own.
//
// Pure: no clock, no I/O, no model call (INV-01). A phone and a server give the same answer.
import { evaluate, type EvalEnv } from "./conditions.ts";
import type { Context } from "./context.ts";
import { flattenParams } from "./context.ts";
import { isoWeekKey, lagosDateKey, toMs, isValidTimestamp } from "./dates.ts";
import { actionErrors, conditionErrors } from "./validate.ts";
import type { Rule, SymptomCode, TriageAction, TriageResult } from "./types.ts";

export const GLUCOSE_RULE_SET_CODE = "glucose_care_triage";

export type GlucoseContextCode = "fasting" | "pre_meal" | "post_meal" | "bedtime" | "night" | "random";
export const GLUCOSE_CONTEXTS: readonly GlucoseContextCode[] = ["fasting", "pre_meal", "post_meal", "bedtime", "night", "random"];

/** Urine ketone strip bands. `moderate` and `large` count as raised ketones (CMO Q7). */
export type KetoneUrine = "negative" | "trace" | "small" | "moderate" | "large";
export const KETONE_URINE_BANDS: readonly KetoneUrine[] = ["negative", "trace", "small", "moderate", "large"];

export type GlucoseSymptomCode =
  | "confusion"
  | "seizure"
  | "unconscious"
  | "cannot_swallow"
  | "vomiting"
  | "abdominal_pain"
  | "fast_breathing"
  | "drowsiness"
  | "very_thirsty_cannot_keep_fluids";
export const GLUCOSE_SYMPTOMS: readonly GlucoseSymptomCode[] = [
  "confusion",
  "seizure",
  "unconscious",
  "cannot_swallow",
  "vomiting",
  "abdominal_pain",
  "fast_breathing",
  "drowsiness",
  "very_thirsty_cannot_keep_fluids",
];

/** The recorded diabetes type (`diabetes_type` enum). Null means none is recorded. */
export type GlucoseDiabetesType = "type_1" | "type_2" | "gestational" | "other";
const DIABETES_TYPES: readonly string[] = ["type_1", "type_2", "gestational", "other"];

export interface GlucoseObservationTrigger {
  readonly type: "glucose";
  /** Glucose in mmol/L. A phone that holds mg/dL converts first with mgDlToMmolL (packages/shared); the server stores mmol/L. */
  readonly reading: { readonly mmol: number; readonly takenAt: string; readonly context: GlucoseContextCode };
  readonly ketones?: { readonly bloodMmol?: number | null; readonly urine?: KetoneUrine | null };
  readonly symptoms: readonly GlucoseSymptomCode[];
}

export interface GlucoseInput {
  readonly trigger: GlucoseObservationTrigger;
  readonly diabetesType: GlucoseDiabetesType | null;
  readonly pregnant: boolean;
  readonly ageYears: number | null;
  /** ISO 8601. The engine never reads the clock. */
  readonly now: string;
  readonly existingOpenTaskKeys?: readonly string[];
}

export interface GlucoseRuleSet {
  readonly code: string;
  readonly version: number;
  readonly status: "draft" | "approved" | "retired";
  readonly params: {
    readonly validation: { readonly glucoseMinMmol: number; readonly glucoseMaxMmol: number; readonly ketoneMaxMmol: number };
    readonly minAdultAgeYears: number;
    /** Hypoglycaemia: ADA levels. Below `severe` is level 2; from `severe` to under `alert` is level 1. */
    readonly hypo: { readonly severe: number; readonly alert: number };
    readonly high: { readonly dka: number; readonly urgent: number; readonly severe: number };
    readonly ketone: { readonly raised: number; readonly dka: number };
    readonly symptomGroups: { readonly [group: string]: readonly string[]; readonly redFlag: readonly string[] };
    readonly rejected: { readonly explanationKey: string; readonly redFlagGuidanceCode: string };
    readonly [extra: string]: unknown;
  };
  readonly rules: readonly Rule[];
}

type RejectReason = NonNullable<TriageResult["reason"]>;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every field a glucose rule may read. All are always present in a context (null when not applicable). */
export const GLUCOSE_CONTEXT_FIELDS = [
  "trigger.type",
  "glucose.mmol",
  "glucose.context",
  "ketone.bloodMmol",
  "ketone.urineRaised",
  "ketone.raised",
  "symptoms.count",
  "pregnant",
  "age",
  "diabetes.type",
] as const;

/**
 * Input validation that runs before any grading (the glucose twin of validateInput): a glucose outside the plausible range is rejected and
 * never graded, anything malformed is `invalid_input`. Returns null when the input is fit to grade.
 */
export function validateGlucoseInput(input: GlucoseInput, ruleSet: GlucoseRuleSet): RejectReason | null {
  const t = input?.trigger as unknown;
  if (!isObj(t) || t.type !== "glucose" || !isValidTimestamp(input.now)) return "invalid_input";
  if (typeof input.pregnant !== "boolean") return "invalid_input";
  // The server's context is built with jsonb_strip_nulls, which DROPS a null: an absent age or diabetes type means "not recorded", exactly like null.
  // Treating absent as malformed would reject every reading of a patient with no date of birth or no diabetes record, silently.
  if (input.ageYears != null && !isNum(input.ageYears)) return "invalid_input";
  if (input.diabetesType != null && !DIABETES_TYPES.includes(input.diabetesType as string)) return "invalid_input";
  if (!Array.isArray(t.symptoms) || !t.symptoms.every((s) => typeof s === "string")) return "invalid_input";
  const r = t.reading;
  if (!isObj(r) || !isNum(r.mmol) || !isValidTimestamp(r.takenAt) || !GLUCOSE_CONTEXTS.includes(r.context as GlucoseContextCode)) return "invalid_input";
  const k = t.ketones;
  if (k !== undefined) {
    if (!isObj(k)) return "invalid_input";
    if (k.bloodMmol !== undefined && k.bloodMmol !== null && !isNum(k.bloodMmol)) return "invalid_input";
    if (k.urine !== undefined && k.urine !== null && !KETONE_URINE_BANDS.includes(k.urine as KetoneUrine)) return "invalid_input";
  }
  const v = ruleSet.params.validation;
  // Only the GLUCOSE can make a reading implausible. A ketone value is a secondary datum (a meter, a typo, a nearby ketone reading) and must never
  // veto the grading of the glucose itself: an out-of-range ketone is clamped in gradeGlucose instead, so a severe low is always graded.
  if (r.mmol < v.glucoseMinMmol || r.mmol > v.glucoseMaxMmol) return "implausible_reading";
  return null;
}

/** The facts a rule can read for this reading. Exposed so a test can pin the exact field list. */
export function buildGlucoseContext(input: GlucoseInput): Context {
  const t = input.trigger;
  const blood = isNum(t.ketones?.bloodMmol) ? t.ketones.bloodMmol : null;
  const urine = t.ketones?.urine ?? null;
  const urineRaised = urine === "moderate" || urine === "large";
  return {
    "trigger.type": "glucose",
    // Compared at the precision a meter shows: one decimal. A mg/dL entry converts to two decimals (70 mg/dL is 3.88 mmol/L), and ADA level 1 is "under 70 mg/dL", so
    // 70 must not read as a low against a 3.9 line. The phone and the server both reach this line, so they round the same way.
    "glucose.mmol": Math.round(t.reading.mmol * 10) / 10,
    "glucose.context": t.reading.context,
    "ketone.bloodMmol": blood,
    "ketone.urineRaised": urineRaised,
    // Filled in by gradeGlucose from the rule set's own line (params.ketone.raised), so the line is data, not code.
    "ketone.raised": false,
    "symptoms.count": t.symptoms.length,
    pregnant: input.pregnant,
    age: input.ageYears ?? null,
    "diabetes.type": input.diabetesType ?? "unknown",
  };
}

export function validateGlucoseRuleSet(value: unknown): string[] {
  if (!isObj(value)) return ["rule set must be an object"];
  const errors: string[] = [];
  if (typeof value.code !== "string" || value.code === "") errors.push("code is required");
  if (!Number.isInteger(value.version) || (value.version as number) < 1) errors.push("version must be a whole number from 1");
  if (!isObj(value.params)) return [...errors, "params is required"];
  const p = value.params;
  const v = p.validation;
  if (!isObj(v) || ![v.glucoseMinMmol, v.glucoseMaxMmol, v.ketoneMaxMmol].every(isNum)) errors.push("params.validation needs glucoseMinMmol, glucoseMaxMmol and ketoneMaxMmol");
  if (!isNum(p.minAdultAgeYears)) errors.push("params.minAdultAgeYears must be a number");
  for (const group of ["hypo", "high", "ketone"] as const) {
    if (!isObj(p[group]) || !Object.values(p[group] as object).every(isNum)) errors.push(`params.${group} must be an object of numbers`);
  }
  if (!isObj(p.symptomGroups) || !Array.isArray(p.symptomGroups.redFlag)) errors.push("params.symptomGroups must be an object with a redFlag list");
  const rj = p.rejected;
  if (!isObj(rj) || typeof rj.explanationKey !== "string" || typeof rj.redFlagGuidanceCode !== "string") {
    errors.push("params.rejected needs explanationKey and redFlagGuidanceCode");
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0) return [...errors, "rules must be a non-empty list"];
  if (errors.length > 0) return errors;

  const known = new Set<string>([...GLUCOSE_CONTEXT_FIELDS, ...Object.keys(flattenParams(p))]);
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
    if (!Array.isArray(rule.triggers) || rule.triggers.length === 0 || !rule.triggers.every((x) => x === "glucose")) {
      errors.push(`${at}: triggers must be exactly glucose`);
    }
    if (typeof rule.explanationKey !== "string" || rule.explanationKey === "") errors.push(`${at}: explanationKey is required`);
    // A glucose rule only ever grades: there is no repeat-reading flow for glucose in this version.
    if (rule.result !== "grade") errors.push(`${at}: result must be grade`);
    if (!["green", "amber", "red"].includes(rule.grade as string)) errors.push(`${at}: grade must be green, amber or red`);
    if (!Array.isArray(rule.actions)) errors.push(`${at}: actions must be a list`);
    else {
      rule.actions.forEach((a, j) => errors.push(...actionErrors(a, `${at}.actions[${j}]`)));
      const kinds = rule.actions.map((a) => (isObj(a) ? a.kind : undefined));
      if (rule.grade === "red" && !(kinds.includes("page_on_call") && kinds.includes("show_emergency_guidance"))) {
        errors.push(`${at}: a red rule must show emergency guidance and page on-call (INV-05)`);
      }
      if (kinds.includes("create_task") && rule.taskAnchor !== "reading" && rule.taskAnchor !== "week") {
        errors.push(`${at}: a task rule needs a taskAnchor of reading or week`);
      }
    }
    errors.push(...conditionErrors(rule.when, `${at}.when`, value, known));
  });
  return errors;
}

const baseResult = {
  grade: null,
  ruleId: null,
  explanationKey: null,
  actions: [],
  matchedRuleIds: [],
  taskKey: null,
  duplicateSuppressed: false,
  recheck: null,
  redFlagSymptomPresent: false,
  reason: null,
} as const;

/**
 * Grades one glucose reading. Same contract as `grade`: an invalid rule set returns `invalid_rule_set` with no guidance (the caller
 * falls back to the bundled rule set, never to nothing); a reading outside the plausible range is rejected and never graded, but a
 * ticked Level 3 symptom still shows guidance. A glucose result is always `graded`.
 */
export function gradeGlucose(input: GlucoseInput, ruleSet: GlucoseRuleSet): TriageResult {
  if (validateGlucoseRuleSet(ruleSet).length > 0) {
    return { ...baseResult, status: "rejected", reason: "invalid_rule_set", ruleSet: { code: "invalid", version: 0 } };
  }
  const id = { code: ruleSet.code, version: ruleSet.version };
  const symptoms: readonly string[] = Array.isArray(input?.trigger?.symptoms) ? input.trigger.symptoms : [];
  const redFlagPresent = symptoms.some((s) => ruleSet.params.symptomGroups.redFlag.includes(s));

  const reason = validateGlucoseInput(input, ruleSet);
  if (reason !== null) {
    const { explanationKey, redFlagGuidanceCode } = ruleSet.params.rejected;
    return {
      ...baseResult,
      status: "rejected",
      reason,
      ruleSet: id,
      explanationKey,
      redFlagSymptomPresent: redFlagPresent,
      actions: redFlagPresent ? [{ kind: "show_emergency_guidance", code: redFlagGuidanceCode }] : [],
    };
  }

  const baseCtx = buildGlucoseContext(input);
  // A blood ketone outside the meter's range is read as the nearest end of the range, never dropped and never a reason to skip grading.
  const rawBlood = baseCtx["ketone.bloodMmol"];
  const blood = typeof rawBlood === "number" ? Math.min(Math.max(rawBlood, 0), ruleSet.params.validation.ketoneMaxMmol) : null;
  const ctx: Context = {
    ...baseCtx,
    "ketone.bloodMmol": blood,
    "ketone.raised": baseCtx["ketone.urineRaised"] === true || (blood !== null && blood >= ruleSet.params.ketone.raised),
  };
  const env: EvalEnv = {
    ctx,
    params: flattenParams(ruleSet.params),
    groups: ruleSet.params.symptomGroups,
    symptoms: new Set(symptoms as SymptomCode[]),
  };
  const matched = ruleSet.rules.filter((r) => evaluate(r.when, env));
  const graded = matched.filter((r) => r.result === "grade");
  const winner = graded.find((r) => r.grade === "red") ?? graded.find((r) => r.grade === "amber") ?? graded.find((r) => r.grade === "green");

  let actions: readonly TriageAction[] = winner?.actions ?? [];
  let taskKey: string | null = null;
  let duplicateSuppressed = false;
  if (winner && actions.some((a) => a.kind === "create_task")) {
    const anchor = winner.taskAnchor === "reading" ? input.trigger.reading.takenAt : isoWeekKey(lagosDateKey(toMs(input.now)));
    taskKey = `${winner.id}:${anchor}`;
    if (input.existingOpenTaskKeys?.includes(taskKey)) {
      actions = actions.filter((a) => a.kind !== "create_task");
      duplicateSuppressed = true;
    }
  }
  return {
    ...baseResult,
    status: "graded",
    grade: winner?.grade ?? "green",
    ruleId: winner?.id ?? null,
    explanationKey: winner?.explanationKey ?? null,
    actions,
    matchedRuleIds: matched.map((r) => r.id),
    taskKey,
    duplicateSuppressed,
    ruleSet: id,
  };
}

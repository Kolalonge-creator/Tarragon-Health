// Single-reading dangerous vitals (pulse, SpO2, temperature): the third half of the triage engine, after blood pressure and glucose.
//
// It is the SAME engine in every way that matters (the glucose-engine.ts approach): the same declarative condition language and evaluator
// (conditions.ts), the same action vocabulary, the same result shape and summary, the same rule semantics (rules run in file order, the first
// red wins, otherwise the highest grade, earliest rule on a tie), the same structural rule validation (conditionErrors, actionErrors, INV-05 on
// every red) and the same reject-before-grading input validation. What differs is only the facts one of these readings brings, so its input,
// context and parameter types are its own. One rule set (`vitals_care_triage`) carries all three metrics; each rule names the one metric it
// grades in `triggers`, and only rules for the reading's own metric are considered.
//
// The numbers are the ones the older per-vital SQL classifiers (private.classify_pulse_level, classify_spo2_level, classify_temperature_level)
// use today, taken over as PROPOSED starting values so that the divergence report can show where the two agree. Two things are different on
// purpose and are listed for the CMO in docs/design/build-vitals-rule-sets.md: a reading outside a physically possible range is rejected as a
// typo and never graded, and a heart rate outside the adult resting range is routed to a clinician (amber) for a patient under 18, because
// the adult pulse bands are not child bands. The emergency bands apply to everyone.
//
// Pure: no clock, no I/O, no model call (INV-01).
import { evaluate, type EvalEnv } from "./conditions.ts";
import type { Context } from "./context.ts";
import { flattenParams } from "./context.ts";
import { isoWeekKey, lagosDateKey, toMs, isValidTimestamp } from "./dates.ts";
import { actionErrors, conditionErrors } from "./validate.ts";
import type { Rule, TriageAction, TriageResult } from "./types.ts";

export const VITALS_RULE_SET_CODE = "vitals_care_triage";

export type VitalsMetric = "pulse" | "spo2" | "temperature";
export const VITALS_METRICS: readonly VitalsMetric[] = ["pulse", "spo2", "temperature"];

export interface VitalsObservationTrigger {
  readonly type: VitalsMetric;
  /** Beats per minute, percent, or degrees Celsius, by `type`. */
  readonly reading: { readonly value: number; readonly takenAt: string };
}

export interface VitalsInput {
  readonly trigger: VitalsObservationTrigger;
  readonly ageYears: number | null;
  /**
   * The patient's own clinician-set amber line (patient_spo2_targets, patient_temperature_targets), when one exists. It can only turn a green reading
   * amber, never touch an amber, red or emergency one (the older triggers behave the same way). Absent or null means no personal line.
   */
  readonly personalAmberLine?: number | null;
  /** ISO 8601. The engine never reads the clock. */
  readonly now: string;
  readonly existingOpenTaskKeys?: readonly string[];
}

export interface VitalsRuleSet {
  readonly code: string;
  readonly version: number;
  readonly status: "draft" | "approved" | "retired";
  readonly params: {
    /** Typo gates: the physically possible range of each metric. Far wider than any band. */
    readonly validation: {
      readonly pulseMin: number;
      readonly pulseMax: number;
      readonly spo2Min: number;
      readonly spo2Max: number;
      readonly temperatureMin: number;
      readonly temperatureMax: number;
    };
    readonly minAdultAgeYears: number;
    readonly pulse: {
      readonly emergencyAtOrBelow: number;
      readonly emergencyAtOrAbove: number;
      readonly redAtOrBelow: number;
      readonly redAtOrAbove: number;
      readonly amberAtOrBelow: number;
      readonly amberAtOrAbove: number;
    };
    readonly spo2: { readonly emergencyBelow: number; readonly redAtOrBelow: number; readonly amberAtOrBelow: number };
    readonly temperature: {
      readonly emergencyAtOrAbove: number;
      readonly emergencyBelow: number;
      readonly redAtOrAbove: number;
      readonly amberAtOrAbove: number;
    };
    readonly rejected: { readonly explanationKey: string };
    readonly [extra: string]: unknown;
  };
  readonly rules: readonly Rule[];
}

type RejectReason = NonNullable<TriageResult["reason"]>;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every field a vitals rule may read. All are always present in a context (null when not applicable). */
export const VITALS_CONTEXT_FIELDS = [
  "trigger.type",
  "pulse.bpm",
  "spo2.pct",
  "temperature.c",
  "spo2.personalAmberAtOrBelow",
  "temperature.personalAmberAtOrAbove",
  "age",
] as const;

/**
 * Input validation that runs before any grading: a value outside the physically possible range is rejected and never graded (a typo is not a
 * crisis), anything malformed is `invalid_input`. Returns null when the input is fit to grade.
 */
export function validateVitalsInput(input: VitalsInput, ruleSet: VitalsRuleSet): RejectReason | null {
  const t = input?.trigger as unknown;
  if (!isObj(t) || !VITALS_METRICS.includes(t.type as VitalsMetric) || !isValidTimestamp(input.now)) return "invalid_input";
  // The server's context is built with jsonb_strip_nulls, which DROPS a null: an absent age or personal line means "not recorded", exactly like null.
  if (input.ageYears != null && !isNum(input.ageYears)) return "invalid_input";
  if (input.personalAmberLine != null && !isNum(input.personalAmberLine)) return "invalid_input";
  const r = t.reading;
  if (!isObj(r) || !isNum(r.value) || !isValidTimestamp(r.takenAt)) return "invalid_input";
  const v = ruleSet.params.validation;
  const [min, max] =
    t.type === "pulse" ? [v.pulseMin, v.pulseMax] : t.type === "spo2" ? [v.spo2Min, v.spo2Max] : [v.temperatureMin, v.temperatureMax];
  return r.value < min || r.value > max ? "implausible_reading" : null;
}

/** The facts a rule can read for this reading. Exposed so a test can pin the exact field list. */
export function buildVitalsContext(input: VitalsInput): Context {
  const t = input.trigger;
  const personal = isNum(input.personalAmberLine) ? input.personalAmberLine : null;
  return {
    "trigger.type": t.type,
    "pulse.bpm": t.type === "pulse" ? t.reading.value : null,
    "spo2.pct": t.type === "spo2" ? t.reading.value : null,
    "temperature.c": t.type === "temperature" ? t.reading.value : null,
    "spo2.personalAmberAtOrBelow": t.type === "spo2" ? personal : null,
    "temperature.personalAmberAtOrAbove": t.type === "temperature" ? personal : null,
    age: input.ageYears ?? null,
  };
}

const NUMERIC_BAND_GROUPS = ["pulse", "spo2", "temperature"] as const;

export function validateVitalsRuleSet(value: unknown): string[] {
  if (!isObj(value)) return ["rule set must be an object"];
  const errors: string[] = [];
  if (typeof value.code !== "string" || value.code === "") errors.push("code is required");
  if (!Number.isInteger(value.version) || (value.version as number) < 1) errors.push("version must be a whole number from 1");
  if (!isObj(value.params)) return [...errors, "params is required"];
  const p = value.params;
  const v = p.validation;
  if (!isObj(v) || !["pulseMin", "pulseMax", "spo2Min", "spo2Max", "temperatureMin", "temperatureMax"].every((k) => isNum(v[k]))) {
    errors.push("params.validation needs pulseMin, pulseMax, spo2Min, spo2Max, temperatureMin and temperatureMax");
  }
  if (!isNum(p.minAdultAgeYears)) errors.push("params.minAdultAgeYears must be a number");
  for (const group of NUMERIC_BAND_GROUPS) {
    if (!isObj(p[group]) || !Object.values(p[group] as object).every(isNum)) errors.push(`params.${group} must be an object of numbers`);
  }
  if (!isObj(p.rejected) || typeof p.rejected.explanationKey !== "string") errors.push("params.rejected needs explanationKey");
  if (!Array.isArray(value.rules) || value.rules.length === 0) return [...errors, "rules must be a non-empty list"];
  if (errors.length > 0) return errors;

  const known = new Set<string>([...VITALS_CONTEXT_FIELDS, ...Object.keys(flattenParams(p))]);
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
    if (!Array.isArray(rule.triggers) || rule.triggers.length !== 1 || !VITALS_METRICS.includes(rule.triggers[0] as VitalsMetric)) {
      errors.push(`${at}: triggers must name exactly one of pulse, spo2, temperature`);
    }
    if (typeof rule.explanationKey !== "string" || rule.explanationKey === "") errors.push(`${at}: explanationKey is required`);
    // A vitals rule only ever grades: there is no repeat-reading flow for these readings in this version.
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
    errors.push(...conditionErrors(rule.when, `${at}.when`, { ...value, params: { ...p, symptomGroups: {} } }, known));
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
 * Grades one pulse, SpO2 or temperature reading. Same contract as `grade` and `gradeGlucose`: an invalid rule set returns `invalid_rule_set` with
 * no guidance (the caller falls back to the older pipeline, never to nothing); a value outside the possible range is rejected and never graded.
 */
export function gradeVitals(input: VitalsInput, ruleSet: VitalsRuleSet): TriageResult {
  if (validateVitalsRuleSet(ruleSet).length > 0) {
    return { ...baseResult, status: "rejected", reason: "invalid_rule_set", ruleSet: { code: "invalid", version: 0 } };
  }
  const id = { code: ruleSet.code, version: ruleSet.version };
  const reason = validateVitalsInput(input, ruleSet);
  if (reason !== null) {
    return { ...baseResult, status: "rejected", reason, ruleSet: id, explanationKey: ruleSet.params.rejected.explanationKey };
  }

  const env: EvalEnv = {
    ctx: buildVitalsContext(input),
    params: flattenParams(ruleSet.params),
    groups: { redFlag: [] },
    symptoms: new Set(),
  };
  const metric = input.trigger.type;
  const matched = ruleSet.rules.filter((r) => r.triggers.includes(metric) && evaluate(r.when, env));
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

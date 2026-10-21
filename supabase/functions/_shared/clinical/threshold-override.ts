// Personal threshold overrides: a doctor-signed, time-limited, per-patient setting that can only cut ALERT NOISE or make the
// engine MORE sensitive. It never edits a signed rule set. The signed rule set grades first; this layer then looks at the
// finished result and may change it in exactly three bounded ways:
//
//   RELAX    an AMBER that came only from the two "chronic burden" amber rules (BP-A2: seven day average over target, BP-A7: low
//            reading with no symptom) becomes GREEN, when the patient's own signed line says the reading is fine for them.
//   TIGHTEN  a GREEN becomes AMBER (BP-A2 against a stricter personal target, or a glucose that is low for a patient who does
//            not feel lows), or a glucose between the red low line and a higher personal red line becomes RED.
//   nothing  in every other case. A red is never lowered. A symptom is never relaxed. A rule that is not on the list below is
//            never relaxed. A pregnant, postpartum, under 18 or age-unknown patient is never relaxed. An unsigned, expired or
//            out-of-limits override is ignored and the signed rule set stands (expiry returns to default by itself).
//
// Pure: no clock (it reads `input.now`), no I/O, no model call (INV-01). The phone does NOT use overrides (it keeps the
// signed default), so offline guidance can only be as urgent as the server, never less. INV-07: the provenance it returns holds
// no reading or target number.
import { buildContext } from "./context.ts";
import type { GlucoseInput, GlucoseRuleSet } from "./glucose-engine.ts";
import { isoWeekKey, lagosDateKey, toMs } from "./dates.ts";
import type { AppliedOverride, OverrideParameter, Rule, RuleSet, TriageAction, TriageInput, TriageResult } from "./types.ts";

export type OverrideDomain = "bp" | "glucose";

/** Blood pressure personal settings. A personal target replaces the care plan target for the seven day average rule (BP-A2). */
export interface BpOverrideParams {
  readonly target?: { readonly systolic: number; readonly diastolic: number };
  /** Relax only: the systolic under which a reading with no symptom is flagged (default line is 90). */
  readonly lowAmberSystolic?: number;
}

/** Glucose personal settings. Both only make the engine more sensitive (hypoglycaemia unawareness). */
export interface GlucoseOverrideParams {
  /** mmol/L under which a glucose is amber (default 3.9). Raising it flags lows sooner. */
  readonly hypoAlertMmol?: number;
  /** mmol/L under which a glucose is RED (default 3.0). Raising it pages sooner. */
  readonly hypoSevereMmol?: number;
}

/** An override as the server loads it: signed, in date, for one patient and one domain. */
export interface ActiveOverride {
  readonly id: string;
  readonly domain: OverrideDomain;
  readonly params: BpOverrideParams | GlucoseOverrideParams;
  /** Null until the doctor signs. An unsigned override is never used. */
  readonly signedAt: string | null;
  readonly expiresAt: string;
}

/**
 * HARD SAFETY CLAMPS. Code, not configuration: a wider range is a code change that goes through review and the Chief Medical
 * Officer. The database CHECK mirrors these numbers (a test pins the two together). The default lines they move are 90 (low),
 * 3.9 and 3.0 (glucose), and the target the care plan gives.
 */
export const OVERRIDE_LIMITS = {
  bp: {
    targetSystolic: { min: 100, max: 160 },
    targetDiastolic: { min: 60, max: 100 },
    lowAmberSystolic: { min: 80, max: 90 },
  },
  glucose: {
    hypoAlertMmol: { min: 3.9, max: 5.0 },
    hypoSevereMmol: { min: 3.0, max: 3.5 },
  },
} as const;

export type IgnoredReason =
  | "wrong_domain"
  | "unsigned"
  | "expired"
  | "out_of_limits"
  | "not_applicable"
  | "excluded_population"
  | "symptoms_present";

export interface OverrideOutcome {
  readonly result: TriageResult;
  /** Why a supplied override left the signed grade alone, or null when it was applied or nothing was supplied/changed. */
  readonly ignored: IgnoredReason | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const inRange = (v: unknown, r: { readonly min: number; readonly max: number }): boolean => typeof v === "number" && Number.isFinite(v) && v >= r.min && v <= r.max;

function onlyKeys(v: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(v).every((k) => allowed.includes(k));
}

/** Errors for an override's params; empty means it is inside the clamps. The server action and the engine both call this. */
export function validateOverrideParams(domain: OverrideDomain, params: unknown): string[] {
  if (!isObj(params)) return ["params must be an object"];
  const errors: string[] = [];
  if (Object.keys(params).length === 0) errors.push("at least one setting is required");
  if (domain === "bp") {
    if (!onlyKeys(params, ["target", "lowAmberSystolic"])) errors.push("unknown blood pressure setting");
    const t = params["target"];
    if (t !== undefined) {
      const L = OVERRIDE_LIMITS.bp;
      if (!isObj(t) || !onlyKeys(t, ["systolic", "diastolic"]) || !inRange(t["systolic"], L.targetSystolic) || !inRange(t["diastolic"], L.targetDiastolic)) {
        errors.push("target is outside the limits");
      } else if ((t["diastolic"] as number) >= (t["systolic"] as number)) {
        errors.push("target diastolic must be under systolic");
      }
    }
    if (params["lowAmberSystolic"] !== undefined && !inRange(params["lowAmberSystolic"], OVERRIDE_LIMITS.bp.lowAmberSystolic)) errors.push("lowAmberSystolic is outside the limits");
    return errors;
  }
  if (!onlyKeys(params, ["hypoAlertMmol", "hypoSevereMmol"])) errors.push("unknown glucose setting");
  if (params["hypoAlertMmol"] !== undefined && !inRange(params["hypoAlertMmol"], OVERRIDE_LIMITS.glucose.hypoAlertMmol)) errors.push("hypoAlertMmol is outside the limits");
  if (params["hypoSevereMmol"] !== undefined && !inRange(params["hypoSevereMmol"], OVERRIDE_LIMITS.glucose.hypoSevereMmol)) errors.push("hypoSevereMmol is outside the limits");
  return errors;
}

/** The first reason this override cannot be used for this domain at this instant, or null when it can. */
function unusable(o: ActiveOverride, domain: OverrideDomain, nowIso: string): IgnoredReason | null {
  if (o.domain !== domain) return "wrong_domain";
  if (o.signedAt === null) return "unsigned";
  // NaN (a corrupt date) is not greater than now, so a corrupt expiry reads as expired: the signed default stands.
  if (!(toMs(o.expiresAt) > toMs(nowIso))) return "expired";
  if (validateOverrideParams(domain, o.params).length > 0) return "out_of_limits";
  return null;
}

const keep = (result: TriageResult, ignored: IgnoredReason | null): OverrideOutcome => ({ result, ignored });

function applied(
  o: ActiveOverride,
  direction: AppliedOverride["direction"],
  parameters: readonly OverrideParameter[],
  base: TriageResult,
  next: TriageResult,
): OverrideOutcome {
  const provenance: AppliedOverride = {
    overrideId: o.id,
    domain: o.domain,
    direction,
    parameters,
    defaultGrade: base.grade as AppliedOverride["defaultGrade"],
    defaultRuleId: base.ruleId,
    finalGrade: next.grade as AppliedOverride["finalGrade"],
    finalRuleId: next.ruleId,
  };
  return { result: { ...next, override: provenance }, ignored: null };
}

type AverageParams = { readonly overSystolic: number; readonly overDiastolic: number; readonly minReadings: number };
type LineParams = { readonly systolic: number; readonly diastolic: number };

/** The only two blood pressure amber rules an override may relax, and the setting that clears each. */
const BP_RELAXABLE: Readonly<Record<string, OverrideParameter>> = { "BP-A2": "target", "BP-A7": "lowAmberSystolic" };

export function applyBpOverride(input: TriageInput, base: TriageResult, ruleSet: RuleSet, override: ActiveOverride | null): OverrideOutcome {
  if (override === null) return keep(base, null);
  const bad = unusable(override, "bp", input.now);
  if (bad !== null) return keep(base, bad);
  if (base.status !== "graded" || input.trigger.type !== "observation") return keep(base, "not_applicable");

  const p = override.params as BpOverrideParams;
  const trigger = input.trigger;
  const average = ruleSet.params["average"] as AverageParams;
  const urgent = ruleSet.params["urgent"] as LineParams;
  const ctx = buildContext(input, ruleSet);
  const avgSys = ctx["avg.systolic"] as number | null;
  const avgDia = ctx["avg.diastolic"] as number | null;
  const count = ctx["avg.count"] as number;
  // The seven day average rule against a target, with the clamp: an average at or over the urgent line always counts, so a personal
  // target can never push the amber line past the urgent line. With no average (count 0) both are null and the rule cannot fire.
  const averageAmber = (t: LineParams): boolean => {
    if (count < average.minReadings || avgSys === null || avgDia === null) return false;
    return avgSys - t.systolic >= average.overSystolic || avgDia - t.diastolic >= average.overDiastolic || avgSys >= urgent.systolic || avgDia >= urgent.diastolic;
  };

  const nonGreen = ruleSet.rules.filter((r) => base.matchedRuleIds.includes(r.id) && !(r.result === "grade" && r.grade === "green")).map((r) => r.id);
  const cleared = (id: string): boolean => {
    if (id === "BP-A2") return p.target !== undefined && !averageAmber(p.target);
    if (id === "BP-A7") return p.lowAmberSystolic !== undefined && trigger.reading.systolic >= p.lowAmberSystolic;
    return false;
  };

  if (base.grade === "amber" && nonGreen.length > 0 && nonGreen.every(cleared)) {
    if (input.pregnant || input.postpartum === true || input.ageYears === null || input.ageYears < ruleSet.params.minAdultAgeYears) return keep(base, "excluded_population");
    if (trigger.symptoms.length > 0) return keep(base, "symptoms_present");
    const t = p.target ?? input.target;
    const green = ruleSet.rules.find((r) => r.id === (trigger.reading.systolic >= t.systolic || trigger.reading.diastolic >= t.diastolic ? "BP-G2" : "BP-G1"));
    if (green === undefined) return keep(base, "not_applicable");
    const parameters = nonGreen.map((id) => BP_RELAXABLE[id] as OverrideParameter);
    return applied(override, "relaxed", parameters, base, {
      ...base, grade: "green", ruleId: green.id, explanationKey: green.explanationKey, actions: green.actions, taskKey: null, duplicateSuppressed: false,
    });
  }

  if (base.grade === "green" && p.target !== undefined && averageAmber(p.target)) {
    const a2 = ruleSet.rules.find((r) => r.id === "BP-A2");
    if (a2 === undefined) return keep(base, "not_applicable");
    const taskKey = `${a2.id}:${isoWeekKey(lagosDateKey(toMs(input.now)))}`;
    const duplicate = input.existingOpenTaskKeys?.includes(taskKey) === true;
    const actions: readonly TriageAction[] = duplicate ? a2.actions.filter((a) => a.kind !== "create_task") : a2.actions;
    return applied(override, "tightened", ["target"], base, {
      ...base, grade: "amber", ruleId: a2.id, explanationKey: a2.explanationKey, actions, taskKey, duplicateSuppressed: duplicate,
    });
  }
  return keep(base, null);
}

const GLUCOSE_RULE_RED: string = "GL-R1";
const GLUCOSE_RULE_AMBER: string = "GL-A1";

export function applyGlucoseOverride(input: GlucoseInput, base: TriageResult, ruleSet: GlucoseRuleSet, override: ActiveOverride | null): OverrideOutcome {
  if (override === null) return keep(base, null);
  const bad = unusable(override, "glucose", input.now);
  if (bad !== null) return keep(base, bad);
  if (base.status !== "graded") return keep(base, "not_applicable");

  const p = override.params as GlucoseOverrideParams;
  // Compared at the precision a meter shows, the same rounding the engine's own context uses.
  const mmol = Math.round(input.trigger.reading.mmol * 10) / 10;
  const find = (id: string): Rule | undefined => ruleSet.rules.find((r: Rule) => r.id === id);

  if (p.hypoSevereMmol !== undefined && mmol < p.hypoSevereMmol && base.grade !== "red") {
    const r1 = find(GLUCOSE_RULE_RED);
    if (r1 === undefined) return keep(base, "not_applicable");
    return applied(override, "tightened", ["hypoSevereMmol"], base, {
      ...base, grade: "red", ruleId: r1.id, explanationKey: r1.explanationKey, actions: r1.actions, taskKey: null, duplicateSuppressed: false,
    });
  }
  if (p.hypoAlertMmol !== undefined && mmol < p.hypoAlertMmol && base.grade === "green") {
    const a1 = find(GLUCOSE_RULE_AMBER);
    if (a1 === undefined) return keep(base, "not_applicable");
    return applied(override, "tightened", ["hypoAlertMmol"], base, {
      ...base, grade: "amber", ruleId: a1.id, explanationKey: a1.explanationKey, actions: a1.actions, taskKey: null, duplicateSuppressed: false,
    });
  }
  return keep(base, null);
}

import { buildContext, flattenParams } from "./context.ts";
import { evaluate, type EvalEnv } from "./conditions.ts";
import { isoWeekKey, lagosDateKey, toMs } from "./dates.ts";
import { validateInput, validateRuleSet } from "./validate.ts";
import type {
  ObservationTrigger,
  RejectReason,
  Rule,
  RuleSet,
  SilenceTrigger,
  SymptomCode,
  TriageAction,
  TriageInput,
  TriageResult,
} from "./types.ts";

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

function rejected(reason: RejectReason, ruleSet: { code: string; version: number }, extra: Partial<TriageResult> = {}): TriageResult {
  return { ...baseResult, status: "rejected", reason, ruleSet, ...extra };
}

/** The part of a task key that says which occurrence of the cause this is. */
function anchorOf(anchor: NonNullable<Rule["taskAnchor"]>, input: TriageInput): string {
  const t = input.trigger;
  if (anchor === "reading") return (t as ObservationTrigger).reading.takenAt;
  if (anchor === "lastReadingDate") {
    const s = t as SilenceTrigger;
    return lagosDateKey(toMs(s.lastReadingAt ?? s.sinceAt));
  }
  return isoWeekKey(lagosDateKey(toMs(input.now)));
}

/**
 * An invalid rule set returns `invalid_rule_set` with no guidance: the caller (phone or server) must then fall back
 * to the bundled rule set rather than show nothing (S12 wires this).
 *
 * The triage engine (spec 6.1): a pure function of its two arguments.
 * No clock, no I/O, no model call (INV-01). The same input and rule set give
 * the same result on a phone and on the server.
 *
 * Rules run in file order. The first red wins and is never held back by a
 * repeat-reading request; otherwise the highest grade wins, earliest rule on a
 * tie. A `recheck` rule never grades: alone it makes the result
 * `recheck_required`; beside an amber it adds the prompt to that amber.
 */
export function grade(input: TriageInput, ruleSet: RuleSet): TriageResult {
  if (validateRuleSet(ruleSet).length > 0) return rejected("invalid_rule_set", { code: "invalid", version: 0 });
  const id = { code: ruleSet.code, version: ruleSet.version };
  const { redFlag } = ruleSet.params.symptomGroups;
  const symptoms: readonly string[] = input.trigger.type === "observation" && Array.isArray(input.trigger.symptoms) ? input.trigger.symptoms : [];
  // S67: a convulsion or loss of consciousness in pregnancy is an emergency whatever the reading says, so a rejected
  // (impossible) reading must still show the guidance. The group is optional: older rule sets simply have none.
  const emergencyGroup = ruleSet.params.symptomGroups.obstetricEmergency ?? [];
  const redFlagPresent = symptoms.some((s) => redFlag.includes(s) || emergencyGroup.includes(s));

  const reason = validateInput(input, ruleSet);
  if (reason !== null) {
    const { explanationKey, redFlagGuidanceCode } = ruleSet.params.rejected;
    return rejected(reason, id, {
      explanationKey,
      redFlagSymptomPresent: redFlagPresent,
      actions: redFlagPresent ? [{ kind: "show_emergency_guidance", code: redFlagGuidanceCode }] : [],
    });
  }

  const ctx = buildContext(input, ruleSet);
  const env: EvalEnv = {
    ctx,
    params: flattenParams(ruleSet.params),
    groups: ruleSet.params.symptomGroups,
    symptoms: new Set(symptoms as SymptomCode[]),
  };
  const matched = ruleSet.rules.filter((r) => r.triggers.includes(input.trigger.type) && evaluate(r.when, env));
  const graded = matched.filter((r) => r.result === "grade");
  const winner =
    graded.find((r) => r.grade === "red") ?? graded.find((r) => r.grade === "amber") ?? graded.find((r) => r.grade === "green");
  const pendingRule = winner?.grade === "red" ? undefined : matched.find((r) => r.result !== "grade");

  const recheck =
    pendingRule?.result === "recheck"
      ? (() => {
          const timing = pendingRule.recheckTiming === "extreme" ? ruleSet.params.extremeRecheck : ruleSet.params.recheck;
          const { afterMinutes, windowMinutes } = timing;
          const since = ctx["recheck.minutesSincePrevious"];
          const waitMinutes = typeof since === "number" && since < afterMinutes ? afterMinutes - since : afterMinutes;
          return { afterMinutes, windowMinutes, waitMinutes };
        })()
      : null;

  const matchedRuleIds = matched.map((r) => r.id);
  if (pendingRule && (!winner || winner.grade === "green")) {
    return {
      ...baseResult,
      status: pendingRule.result === "ask" ? "symptom_check_required" : "recheck_required",
      ruleId: pendingRule.id,
      explanationKey: pendingRule.explanationKey,
      actions: pendingRule.actions,
      matchedRuleIds,
      recheck,
      ruleSet: id,
    };
  }

  let actions: readonly TriageAction[] = [...(winner?.actions ?? []), ...(pendingRule?.actions ?? [])];
  let taskKey: string | null = null;
  let duplicateSuppressed = false;
  if (winner && actions.some((a) => a.kind === "create_task")) {
    taskKey = `${winner.id}:${anchorOf(winner.taskAnchor as NonNullable<Rule["taskAnchor"]>, input)}`;
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
    matchedRuleIds,
    taskKey,
    duplicateSuppressed,
    recheck,
    ruleSet: id,
  };
}

/**
 * How long a first reading can wait for its repeat before it is graded as if repeated. A reading at or above the
 * extreme line (200/130) waits for the 2 hour recheck; any other waits the standard few minutes. The phone and the
 * server both use this, so they agree on when "no repeat" is final.
 */
export function recheckWindowMinutes(ruleSet: RuleSet, firstReading: { systolic: number; diastolic: number }): number {
  const { extreme } = ruleSet.params;
  const isExtreme = firstReading.systolic >= extreme.systolic || firstReading.diastolic >= extreme.diastolic;
  return (isExtreme ? ruleSet.params.extremeRecheck : ruleSet.params.recheck).windowMinutes;
}

import { daysToMs, lagosDaysBetween, toMs } from "./dates";
import type { Reading, RuleSet, TriageInput } from "./types";

export type ContextValue = number | string | boolean | null;
export type Context = Readonly<Record<string, ContextValue>>;

/** Every field a rule may read. All are always present in a context (null when not applicable). */
export const CONTEXT_FIELDS = [
  "trigger.type",
  "reading.systolic",
  "reading.diastolic",
  "previous.systolic",
  "previous.diastolic",
  "recheck.kind",
  "recheck.minutesSincePrevious",
  "target.systolic",
  "target.diastolic",
  "avg.systolic",
  "avg.diastolic",
  "avg.count",
  "avg.systolicOver",
  "avg.diastolicOver",
  "adherence.percent7d",
  "silence.days",
  "pathway.carePack",
  "pregnant",
  "age",
] as const;

/** Numeric `params` values flattened to dotted names (`params.recheck.afterMinutes`), so a rule can refer to them. */
export function flattenParams(params: object, prefix = "params"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number") out[`${prefix}.${key}`] = value;
    else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(out, flattenParams(value, `${prefix}.${key}`));
    }
  }
  return out;
}

const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/** Readings usable for an average: real, plausible, inside the window, not from the future. */
function windowReadings(input: TriageInput, ruleSet: RuleSet, nowMs: number): Reading[] {
  const { validation, averageWindowDays } = ruleSet.params;
  const current = input.trigger.type === "observation" ? [input.trigger.reading] : [];
  return [...input.history, ...current].filter((r) => {
    const t = toMs(r.takenAt);
    return (
      Number.isFinite(t) &&
      t <= nowMs &&
      nowMs - t < daysToMs(averageWindowDays) &&
      r.systolic >= validation.systolicMin &&
      r.systolic <= validation.systolicMax &&
      r.diastolic >= validation.diastolicMin &&
      r.diastolic <= validation.diastolicMax &&
      r.diastolic <= r.systolic
    );
  });
}

export function buildContext(input: TriageInput, ruleSet: RuleSet): Context {
  const nowMs = toMs(input.now);
  const trigger = input.trigger;
  const observation = trigger.type === "observation" ? trigger : null;
  const repeat = observation?.recheck?.kind === "repeat" ? observation.recheck : null;
  const used = windowReadings(input, ruleSet, nowMs);
  const avgSys = used.length > 0 ? mean(used.map((r) => r.systolic)) : null;
  const avgDia = used.length > 0 ? mean(used.map((r) => r.diastolic)) : null;
  const silenceFrom = trigger.type === "silence" ? (trigger.lastReadingAt ?? trigger.sinceAt) : null;

  return {
    "trigger.type": trigger.type,
    "reading.systolic": observation?.reading.systolic ?? null,
    "reading.diastolic": observation?.reading.diastolic ?? null,
    "previous.systolic": repeat?.previous.systolic ?? null,
    "previous.diastolic": repeat?.previous.diastolic ?? null,
    "recheck.kind": observation?.recheck?.kind ?? "none",
    "recheck.minutesSincePrevious": repeat?.minutesSincePrevious ?? null,
    "target.systolic": input.target.systolic,
    "target.diastolic": input.target.diastolic,
    "avg.systolic": avgSys,
    "avg.diastolic": avgDia,
    "avg.count": used.length,
    "avg.systolicOver": avgSys === null ? null : avgSys - input.target.systolic,
    "avg.diastolicOver": avgDia === null ? null : avgDia - input.target.diastolic,
    "adherence.percent7d": trigger.type === "adherence" ? trigger.percent7d : null,
    "silence.days": silenceFrom === null ? null : lagosDaysBetween(toMs(silenceFrom), nowMs),
    "pathway.carePack": input.pathway.state === "care_pack_active",
    pregnant: input.pregnant,
    age: input.ageYears,
  };
}

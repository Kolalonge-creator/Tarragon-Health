/**
 * Hypertension adapter (TH-CP-HTN-001) — spec §5.1.
 * Emphasis: diet (salt), activity, behaviour. Signature red flag: ≥180/120.
 */
import type { ConditionAdapter, RedFlagRule } from "../types/index";

/** BP measurements carry valueJson {sys,dia,pulse} (spec §4.3). */
function bp(json: Record<string, unknown> | undefined): { sys?: number; dia?: number } {
  return {
    sys: typeof json?.sys === "number" ? json.sys : undefined,
    dia: typeof json?.dia === "number" ? json.dia : undefined,
  };
}

const htnRedFlags: RedFlagRule[] = [
  {
    key: "htn.hypertensive_crisis",
    module: "activity",
    severity: "red",
    level: 3,
    action: "same_day_review",
    when: (input) => {
      if (input.measurement.type !== "bp") return false;
      const { sys, dia } = bp(input.measurement.valueJson);
      return (sys ?? 0) >= 180 || (dia ?? 0) >= 120;
    },
    safetyNetMessageKey: "safety.bp_high",
  },
];

export const htnAdapter: ConditionAdapter = {
  key: "htn",
  carePlanCondition: "hypertension",
  modules: {
    diet: { enabled: true, weight: 1 }, // salt emphasis
    activity: { enabled: true, weight: 0.9 },
    behaviour: { enabled: true, weight: 0.8 },
    sleep: { enabled: true, weight: 0.5 },
    stress: { enabled: true, weight: 0.6 },
  },
  targets: {
    headline: "Blood pressure below 140/90 (below 130/80 if high-risk)",
  },
  monitoring: [{ type: "bp", cadence: "daily", phases: [] }],
  redFlags: htnRedFlags,
  cadence: {
    byPhase: {
      continuous: { remindersPerWeek: 4, nudgesPerWeek: 2 },
    },
  },
  contentPackId: "htn-v1",
  guardrails: { autoPauseOnEdFlag: false, noNumericTargetsIfEd: false },
};

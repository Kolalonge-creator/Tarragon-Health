/**
 * Diabetes adapter (TH-CP-DM-001) — spec §5.1.
 * Emphasis: diet (carb/hypo-awareness), activity, behaviour.
 * Signature red flags: severe hypo, DKA/ketones. Insulin is never "stopped".
 */
import type { ConditionAdapter, RedFlagRule } from "../types/index";

const SEVERE_HYPO_MMOL = 3.0; // spec §8.2: glucose < 3.0 ⇒ severe hypo
const DKA_KETONES_MMOL = 3.0; // spec §8.2: ketones ≥ 3.0 ⇒ DKA workflow
const HYPERGLYCAEMIC_MMOL = 25.0; // very high glucose ⇒ DKA/HHS eval

const diabetesRedFlags: RedFlagRule[] = [
  {
    key: "dm.severe_hypo",
    module: "diet",
    severity: "red",
    level: 3,
    action: "same_day_review",
    when: (input) =>
      input.measurement.type === "glucose" &&
      (input.measurement.valueNum ?? Infinity) < SEVERE_HYPO_MMOL,
    safetyNetMessageKey: "safety.hypo",
  },
  {
    key: "dm.ketones_dka",
    module: "diet",
    severity: "red",
    level: 3,
    action: "same_day_review",
    when: (input) =>
      input.measurement.type === "ketones" &&
      (input.measurement.valueNum ?? 0) >= DKA_KETONES_MMOL,
    safetyNetMessageKey: "safety.dka",
  },
  {
    key: "dm.severe_hyper",
    module: "diet",
    severity: "red",
    level: 3,
    action: "same_day_review",
    when: (input) =>
      input.measurement.type === "glucose" &&
      (input.measurement.valueNum ?? 0) >= HYPERGLYCAEMIC_MMOL,
    safetyNetMessageKey: "safety.hyper",
  },
];

export const diabetesAdapter: ConditionAdapter = {
  key: "diabetes",
  carePlanCondition: "diabetes",
  modules: {
    diet: { enabled: true, weight: 1 }, // carb + hypo awareness
    activity: { enabled: true, weight: 0.9 },
    behaviour: { enabled: true, weight: 0.8 },
    sleep: { enabled: true, weight: 0.5 },
    stress: { enabled: true, weight: 0.6 },
  },
  targets: {
    headline: "HbA1c below 7% (individualised); improve time-in-range",
  },
  monitoring: [
    { type: "glucose", cadence: "daily", phases: [] },
    { type: "ketones", cadence: "as-needed", phases: [] },
  ],
  redFlags: diabetesRedFlags,
  cadence: {
    byPhase: {
      continuous: { remindersPerWeek: 5, nudgesPerWeek: 2 },
    },
  },
  contentPackId: "diabetes-v1",
  guardrails: { autoPauseOnEdFlag: false, noNumericTargetsIfEd: false },
};

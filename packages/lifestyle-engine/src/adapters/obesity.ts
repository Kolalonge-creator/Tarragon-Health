/**
 * Obesity adapter (TH-CP-OB-001) — the FULLEST module set (spec §5.1).
 *
 * The engine was designed obesity-complete; HTN and DM are subsets. Signature
 * guardrail: an eating-disorder / self-harm signal AUTO-PAUSES weight-loss
 * tasks/nudges (spec §6, §9.3, §18.3). Person-first, no crash diets.
 */
import type { ConditionAdapter, RedFlagRule } from "../types/index";

/** Sustained rapid loss vs recent history is a flag (spec §8.2). */
function rapidWeightLoss(recentKg: number[], latestKg: number): boolean {
  if (recentKg.length === 0) return false;
  const oldest = recentKg[recentKg.length - 1];
  if (oldest === undefined) return false;
  // > ~1.5% of body weight per week is faster than safe lifestyle loss.
  return oldest - latestKg > oldest * 0.015;
}

const obesityRedFlags: RedFlagRule[] = [
  {
    key: "obesity.ed_self_harm",
    module: "behaviour",
    severity: "emergency",
    level: 4,
    // The critical one: pause weight-loss AND route to a doctor immediately.
    action: "auto_pause_weightloss",
    when: (input) =>
      (input.measurement.type === "mood" &&
        input.measurement.valueJson?.eatingDisorderRisk === true) ||
      (input.measurement.type === "food_log" &&
        input.measurement.valueJson?.purging === true),
    safetyNetMessageKey: "safety.ed_support",
  },
  {
    key: "obesity.rapid_weight_loss",
    module: "diet",
    severity: "amber",
    level: 2,
    action: "same_day_review",
    when: (input) => {
      if (input.measurement.type !== "weight") return false;
      const latest = input.measurement.valueNum;
      if (latest === undefined) return false;
      const recent = (input.recent ?? [])
        .filter((m) => m.type === "weight" && m.valueNum !== undefined)
        .map((m) => m.valueNum as number);
      return rapidWeightLoss(recent, latest);
    },
    safetyNetMessageKey: "safety.rapid_change",
  },
];

export const obesityAdapter: ConditionAdapter = {
  key: "obesity",
  carePlanCondition: "obesity",
  modules: {
    diet: { enabled: true, weight: 1 },
    activity: { enabled: true, weight: 1 },
    behaviour: { enabled: true, weight: 1 },
    sleep: { enabled: true, weight: 0.8 },
    stress: { enabled: true, weight: 0.8 },
  },
  targets: {
    headline: "5–10% weight loss, then maintenance",
    detail: { waist: "reduce waist circumference", maintenance: "sustain the loss" },
  },
  monitoring: [
    { type: "weight", cadence: "weekly", phases: [] },
    { type: "waist", cadence: "monthly", phases: [] },
    { type: "activity_minutes", cadence: "weekly", phases: [] },
    { type: "mood", cadence: "weekly", phases: [] },
    { type: "food_log", cadence: "3x/week", phases: ["foundation", "build"] },
  ],
  redFlags: obesityRedFlags,
  cadence: {
    byPhase: {
      foundation: { remindersPerWeek: 3, nudgesPerWeek: 3 },
      build: { remindersPerWeek: 2, nudgesPerWeek: 2 },
      maintenance: { remindersPerWeek: 1, nudgesPerWeek: 1 },
    },
  },
  contentPackId: "obesity-v1",
  guardrails: { autoPauseOnEdFlag: true, noNumericTargetsIfEd: true },
};

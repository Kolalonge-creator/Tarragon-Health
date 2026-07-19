/**
 * Shared base red-flag rules applied to EVERY condition (spec §9.1).
 *
 * These are the universal safety nets — self-harm, cardiac/stroke symptoms,
 * pregnancy routing — that must fire regardless of which adapter is active.
 * The evaluator (Phase 2) concatenates these with the adapter's own rules.
 *
 * Rules are pure data: each `when` is a side-effect-free predicate.
 */
import type { RedFlagRule } from "../types/index";

/** Convention for `mood` measurements: valueJson may carry a self-harm item. */
function selfHarmPositive(json: Record<string, unknown> | undefined): boolean {
  return json?.selfHarm === true;
}

/** Convention for `symptom` measurements: valueJson.redFlag flags danger signs. */
function symptomRedFlag(json: Record<string, unknown> | undefined): boolean {
  return json?.redFlag === true;
}

export const BASE_RED_FLAG_RULES: readonly RedFlagRule[] = [
  {
    key: "base.self_harm",
    module: "behaviour",
    severity: "emergency",
    level: 4,
    action: "page_oncall",
    when: (input) =>
      input.measurement.type === "mood" &&
      selfHarmPositive(input.measurement.valueJson),
    safetyNetMessageKey: "safety.self_harm",
  },
  {
    key: "base.cardiac_or_stroke_symptom",
    severity: "emergency",
    level: 4,
    action: "page_oncall",
    when: (input) =>
      input.measurement.type === "symptom" &&
      symptomRedFlag(input.measurement.valueJson),
    safetyNetMessageKey: "safety.emergency_symptom",
  },
  {
    // Pregnancy is not measurement-driven; it routes any active patient to
    // obstetric care (spec §5 special guardrails). Amber so a doctor reviews.
    key: "base.pregnancy_routing",
    severity: "amber",
    level: 2,
    action: "refer",
    when: (_input, patient) => patient.isPregnant,
    safetyNetMessageKey: "safety.pregnancy_routing",
  },
] as const;

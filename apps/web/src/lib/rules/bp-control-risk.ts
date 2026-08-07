import type { Enums } from "@tarragon/shared";

/**
 * Maps the 30-day BP control rate (% of readings under the control
 * threshold, from services/ml's assess_bp_control) onto the platform's
 * shared risk_level enum, so a poorly-controlled patient's bp_control score
 * actually flows through the same pipes every other patient_risk_scores row
 * does — RiskSignalsCard (which only renders a row when risk_level is
 * non-null) and private.queue_care_outreach's high/very_high nightly scan.
 * Before this, assessBpControlBestEffort never set risk_level at all, so
 * bp_control rows were invisible to both.
 *
 * Thresholds are a rule-based heuristic (this module's own "rule-based now,
 * ML-based later" philosophy, per patient_risk_scores' own comment) built
 * around the WHO/ISH general-population "controlled" cutoff this same
 * control-rate figure is computed from — not a second, independent clinical
 * judgement.
 */
export function bpControlRiskLevel(controlRatePercent: number): Enums<"risk_level"> {
  if (controlRatePercent >= 80) return "low";
  if (controlRatePercent >= 60) return "moderate";
  if (controlRatePercent >= 40) return "high";
  return "very_high";
}

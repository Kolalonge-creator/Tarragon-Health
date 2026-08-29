/**
 * Normal/Exception status for a card on the clinician-facing patient
 * monitoring grid. Deliberately NOT "has an open clinician_alerts row" alone:
 * on a plan where vitals_red_flag_doctor_escalation gates the real red-flag
 * engines from writing an alert (20260810120000_gate_vitals_red_flag_
 * escalation_to_paid_plans.sql — Tarragon Free), a dangerous reading is still
 * classified but raises no alert row, so an alert-only check would silently
 * show that patient as Normal. This combines both signals — see
 * CLAUDE.md's "never deprioritise or silently swallow an abnormal reading".
 */
import type { VitalLevel } from "@/lib/rules/vital-level-style";

export type MonitoringStatus = "normal" | "exception";
export type { VitalLevel };

export interface MonitoringStatusInput {
  /** Any open (status = 'open' or 'acknowledged') clinician_alerts row at
   * clinician_review/urgent_escalation/emergency for this patient. */
  hasOpenAlert: boolean;
  /** The latest-reading classification for each clinically-classified vital
   * this card shows (BP, SpO2, temperature, glucose) — 'unknown' for a vital
   * with no reading on file. */
  vitalLevels: VitalLevel[];
}

export function computeMonitoringStatus({
  hasOpenAlert,
  vitalLevels,
}: MonitoringStatusInput): MonitoringStatus {
  if (hasOpenAlert) return "exception";
  if (vitalLevels.some((level) => level === "red" || level === "emergency")) {
    return "exception";
  }
  return "normal";
}

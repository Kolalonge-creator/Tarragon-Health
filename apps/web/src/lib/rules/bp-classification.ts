/**
 * Blood-pressure triage bands — TH-CP-HTN-001 §6.3 / §15.
 *
 * This mirrors the authoritative DB classifier `private.classify_bp_level`
 * (migration `bp_red_flag_engine`), which is what actually raises alerts on
 * insert. This TS copy exists ONLY for non-clinical presentation — the
 * Green/Amber/Red/Emergency badge shown next to a reading in the patient and
 * clinician history. It never gates an escalation (the trigger does) and must
 * stay in lock-step with the SQL bands; the unit tests pin both.
 *
 * Home BP thresholds (Tarragon's primary input). Clinic readings run ~5 mmHg
 * higher, but classifying on home thresholds is the conservative choice.
 */
export type BpLevel = "green" | "amber" | "red" | "emergency" | "unknown";

export function classifyBpLevel(
  systolic: number | null | undefined,
  diastolic: number | null | undefined
): BpLevel {
  if (systolic == null || diastolic == null) return "unknown";
  if (diastolic >= 120 || systolic >= 200) return "emergency";
  if (systolic >= 160 || diastolic >= 100) return "red";
  if (systolic >= 135 || diastolic >= 85) return "amber";
  return "green";
}

export const BP_LEVEL_LABEL: Record<BpLevel, string> = {
  green: "At target",
  amber: "Above target",
  red: "High — urgent review",
  emergency: "Crisis range",
  unknown: "—",
};

/** Non-diagnostic, patient-facing one-liner. Never a clinical all-clear (§20). */
export function bpTrendNote(level: BpLevel): string {
  switch (level) {
    case "green":
      return "Thanks — this reading is within your target range. Keep going.";
    case "amber":
      return "Thanks. This is a little above target this week; your care team will review.";
    case "red":
      return "Thanks. This reading is high. Please rest for 5 minutes and re-check, then reply. Your care team is being notified.";
    case "emergency":
      return "This reading is very high. Please seek urgent care now — do not take extra tablets. Your care team is being alerted.";
    default:
      return "Thanks — your reading has been logged.";
  }
}

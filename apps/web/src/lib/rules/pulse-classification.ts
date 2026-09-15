/**
 * Heart rate (pulse) triage bands.
 *
 * Mirrors the authoritative DB classifier `private.classify_pulse_level`
 * (migration `pulse_red_flag_engine`), which is what actually raises alerts
 * on insert. This TS copy exists ONLY for non-clinical presentation — the
 * Green/Amber/Red/Emergency badge shown next to a reading in the patient and
 * clinician history. It never gates an escalation (the trigger does) and
 * must stay in lock-step with the SQL bands; the unit tests pin both.
 *
 * A single logged BPM carries no rhythm information — this is deliberately
 * NOT arrhythmia/AF detection, only extreme-value triage (assess-heart-
 * rate.ts's 30-day pattern check is the separate, complementary mechanism
 * for a sustained abnormal pattern across many readings).
 */
export type PulseLevel = "green" | "amber" | "red" | "emergency" | "unknown";

export function classifyPulseLevel(pulseBpm: number | null | undefined): PulseLevel {
  if (pulseBpm == null) return "unknown";
  if (pulseBpm <= 35 || pulseBpm >= 150) return "emergency";
  if (pulseBpm <= 39 || pulseBpm >= 121) return "red";
  if (pulseBpm <= 49 || pulseBpm >= 101) return "amber";
  return "green";
}

export const PULSE_LEVEL_LABEL: Record<PulseLevel, string> = {
  green: "Typical range",
  amber: "Outside typical range",
  red: "Abnormal — urgent review",
  emergency: "Severe brady/tachycardia range",
  unknown: "—",
};

/**
 * SpO2 (oxygen saturation) triage bands.
 *
 * Mirrors the authoritative DB classifier `private.classify_spo2_level`
 * (migration `spo2_red_flag_engine`), which is what actually raises alerts on
 * insert. This TS copy exists ONLY for non-clinical presentation — the
 * Green/Amber/Red/Emergency badge shown next to a reading in the patient and
 * clinician history. It never gates an escalation (the trigger does) and must
 * stay in lock-step with the SQL bands; the unit tests pin both.
 */
export type Spo2Level = "green" | "amber" | "red" | "emergency" | "unknown";

export function classifySpo2Level(spo2Pct: number | null | undefined): Spo2Level {
  if (spo2Pct == null) return "unknown";
  if (spo2Pct < 90) return "emergency";
  if (spo2Pct <= 92) return "red";
  if (spo2Pct <= 94) return "amber";
  return "green";
}

export const SPO2_LEVEL_LABEL: Record<Spo2Level, string> = {
  green: "At target",
  amber: "Below target",
  red: "Low — urgent review",
  emergency: "Hypoxia range",
  unknown: "—",
};

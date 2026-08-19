/**
 * Body temperature triage bands.
 *
 * Mirrors the authoritative DB classifier `private.classify_temperature_level`
 * (migration `temperature_red_flag_engine`), which is what actually raises
 * alerts on insert. This TS copy exists ONLY for non-clinical presentation —
 * the Green/Amber/Red/Emergency badge shown next to a reading in the patient
 * and clinician history. It never gates an escalation (the trigger does) and
 * must stay in lock-step with the SQL bands; the unit tests pin both.
 *
 * Mild hypothermia (35.0-35.7C) currently falls to GREEN — an open question
 * flagged for Clinical Director review, not decided here (see the
 * temperature_red_flag_engine migration).
 */
export type TemperatureLevel = "green" | "amber" | "red" | "emergency" | "unknown";

export function classifyTemperatureLevel(temperatureC: number | null | undefined): TemperatureLevel {
  if (temperatureC == null) return "unknown";
  if (temperatureC >= 40.0 || temperatureC < 35.0) return "emergency";
  if (temperatureC >= 39.0) return "red";
  if (temperatureC >= 38.0) return "amber";
  return "green";
}

export const TEMPERATURE_LEVEL_LABEL: Record<TemperatureLevel, string> = {
  green: "Normal range",
  amber: "Fever",
  red: "High fever — urgent review",
  emergency: "Emergency range",
  unknown: "—",
};

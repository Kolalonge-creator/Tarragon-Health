/**
 * The words around the glucose profile. Kept out of the components so they can be tested as text.
 *
 * Rules these sentences follow: they describe what the readings did and when, never why; they never name a dose, a medicine or a change to either
 * (that is a clinical decision for the care team, and the assistant must not make it); they never call a result good or bad control; and the
 * patient wording asks the person to tell their care team, it does not tell them to act on a pattern.
 */
import { formatGlucose, type GlucoseDisplayUnit } from "@tarragon/shared";
import { clockLabel, type AgpConfig, type AgpPattern } from "./agp";

const wholeDay = (p: AgpPattern): boolean => p.startMinute === 0 && p.endMinute === 0;

/** "between 18:00 and 21:30", or "across the whole day" when the window wraps all of it. */
export function windowPhrase(p: AgpPattern): string {
  return wholeDay(p) ? "across the whole day" : `between ${clockLabel(p.startMinute)} and ${clockLabel(p.endMinute)}`;
}

export function patientPatternSentence(p: AgpPattern, unit: GlucoseDisplayUnit, config: AgpConfig): string {
  const edge = p.kind === "low" ? config.band_edges_mmol_l.low : config.band_edges_mmol_l.high;
  const where = windowPhrase(p);
  return p.kind === "low"
    ? `Readings below ${formatGlucose(edge, unit)} showed up often ${where}.`
    : `Readings above ${formatGlucose(edge, unit)} showed up often ${where}.`;
}

export function clinicianPatternSentence(p: AgpPattern, unit: GlucoseDisplayUnit, config: AgpConfig): string {
  const edge = p.kind === "low" ? config.band_edges_mmol_l.low : config.band_edges_mmol_l.high;
  const bound = p.kind === "low" ? "below" : "above";
  const threshold = p.kind === "low" ? config.pattern.low_share_pct : config.pattern.high_share_pct;
  return `${p.kind === "low" ? "Low" : "High"} ${wholeDay(p) ? "all day" : `${clockLabel(p.startMinute)} to ${clockLabel(p.endMinute)}`}: at least ${threshold}% of readings ${bound} ${formatGlucose(edge, unit)} in every half hour of the window, up to ${p.peakSharePct}%.`;
}

export const PATIENT_FOOTNOTE =
  "This is a summary of your sensor readings, not a diagnosis. If it does not match how you have been feeling, tell your care team.";

export const CLINICIAN_FOOTNOTE =
  "Display only: this view raises no task and no page. Sensor and wearable glucose only, fingerstick readings are not included. Times are Lagos time. Pattern settings are proposed and not yet signed.";

export function insufficientSentence(daysWithData: number, minDays: number): string {
  return `Your profile fills in once about ${minDays} days of sensor readings are in. So far there are ${daysWithData}.`;
}

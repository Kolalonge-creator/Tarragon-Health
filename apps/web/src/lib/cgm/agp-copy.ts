/**
 * The words around the glucose profile. Kept out of the components so they can be tested as text.
 *
 * Rules these sentences follow: they describe what the readings did and when, never why; they never name a dose, a medicine or a change to either
 * (that is a clinical decision for the care team, and the assistant must not make it); they never call a result good or bad control; and the
 * patient wording asks the person to tell their care team, it does not tell them to act on a pattern.
 */
import { formatGlucose, type GlucoseDisplayUnit } from "@tarragon/shared";
import { clockLabel, type AgpConfig, type AgpMetrics, type AgpPattern, type InsufficientReason } from "./agp";

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
  return `${p.kind === "low" ? "Low" : "High"} ${wholeDay(p) ? "all day" : `${clockLabel(p.startMinute)} to ${clockLabel(p.endMinute)}`}: at least ${threshold}% of readings ${bound} ${formatGlucose(edge, unit)} in every ${config.bin_minutes} minute slot of the window, up to ${p.peakSharePct}%.`;
}

export const PATIENT_FOOTNOTE =
  "This is a summary of your sensor readings, not a diagnosis. If it does not match how you have been feeling, tell your care team.";

/** "Lagos time" for the platform zone, the zone's own name for any other the configuration might name. */
export function zoneLabel(timezone: string): string {
  return timezone === "Africa/Lagos" ? "Lagos time" : timezone;
}

export function clinicianFootnote(config: AgpConfig): string {
  return `Display only: this view raises no task and no page. Sensor and wearable glucose only, fingerstick readings are not included. Times are ${zoneLabel(config.timezone)}. Pattern settings are proposed and not yet signed.`;
}

/** The true reason the profile is not drawn yet: too few days, or the sensor was off for too much of the time. */
export function insufficientSentence(reason: InsufficientReason | null, metrics: AgpMetrics, config: AgpConfig): string {
  if (reason === "coverage") {
    return `Your profile fills in once your sensor has recorded for about ${config.min_active_pct}% of the time. So far it is ${Math.round(metrics.activePct)}%.`;
  }
  return `Your profile fills in once about ${config.min_days_with_data} days of sensor readings are in. So far there are ${metrics.daysWithData}.`;
}

/** Shown instead of the "fills in" sentence when the read hit its row limit: the shortfall is in what was loaded, not in the sensor. */
export function truncatedSentence(audience: "patient" | "clinician", limit: number): string {
  return audience === "patient"
    ? "You have a lot of readings, so this view uses the most recent ones and may cover fewer days than usual."
    : `Read limit reached (${limit.toLocaleString("en-NG")} readings per source): the oldest days in the window may be missing.`;
}

/** The share as a whole percent, or "<1%" when there are readings in it but they are under one percent (never "0%" for a real exposure). */
export function pctLabel(roundedPct: number, exactPct: number): string {
  return exactPct > 0 && exactPct < 1 ? "<1%" : `${roundedPct}%`;
}

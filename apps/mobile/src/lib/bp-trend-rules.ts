import { daysBetween, lagosLocalDate } from "./lagos-date";
import type { StartingSuggestionTarget, TrendDisplayConfig } from "./s07-config";

/**
 * Display rules that sit on top of the existing trend model (bp-trend.ts, the
 * Skia TrendChart): when to show a list instead of a line, where a line breaks,
 * and which target band to draw and how to label it. Pure, no drawing.
 *
 * Nothing here grades a reading. "Within" and "above" describe a reading
 * against the patient's own target band, in the app's wording "above your
 * target range", never "uncontrolled" and never an alarm colour for an amber
 * state. Grading and paging stay with S11/S12 (OQ-67).
 */
export type TrendDisplay = "chart" | "list";

/** Fewer readings than the configured minimum shows a list: a line through two dots implies a trend that is not there. */
export function trendDisplayMode(readingCount: number, cfg: TrendDisplayConfig): TrendDisplay {
  return readingCount >= cfg.minReadingsForChart ? "chart" : "list";
}

/**
 * Split time-ordered points into line segments, breaking wherever two
 * neighbours are more than `gapBreakDays` Lagos days apart, so the chart never
 * draws a line across readings that were never taken.
 */
export function splitAtGaps<T extends { atMs: number }>(points: readonly T[], cfg: TrendDisplayConfig): T[][] {
  const sorted = [...points].sort((a, b) => a.atMs - b.atMs);
  const segments: T[][] = [];
  let current: T[] = [];
  for (const p of sorted) {
    const prev = current[current.length - 1];
    if (prev && daysBetween(lagosLocalDate(prev.atMs), lagosLocalDate(p.atMs)) > cfg.gapBreakDays) {
      segments.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** A clinician-set personal target, as stored with who set it and when. */
export interface PersonalBpTarget {
  systolicBelow: number;
  diastolicBelow: number;
  setBy: string | null;
  setAt: string | null;
  /**
   * Set only for a target read from the server's own answer (my_home_bp_target), which is the
   * target its alerts use: "care_team" when a clinician recorded it, "standard" for the standard
   * starting target (or one with no clinician recorded). Absent for a bare patient_bp_targets row,
   * where setBy and setAt decide.
   */
  origin?: "care_team" | "standard";
}

export function hasUsableTarget(p: PersonalBpTarget | null): p is PersonalBpTarget {
  return !!p && isTargetNumber(p.systolicBelow) && isTargetNumber(p.diastolicBelow);
}

export type TargetBandSource = "clinician" | "starting_suggestion";

export interface TargetBand {
  systolicBelow: number;
  diastolicBelow: number;
  /** True only when a named clinician and a date are recorded. */
  confirmed: boolean;
  source: TargetBandSource;
  setBy: string | null;
  setAt: string | null;
}

function isTargetNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Pick the band to draw. A personal target counts as confirmed only with a
 * clinician name and a date. A personal target missing either is still drawn
 * but labelled as a suggestion, and with no usable personal target the
 * configured starting suggestion is used. A default is never presented as if a
 * clinician set it.
 */
export function resolveTargetBand(
  personal: PersonalBpTarget | null,
  suggestion: StartingSuggestionTarget,
): TargetBand {
  if (hasUsableTarget(personal)) {
    const confirmed = !!personal.setBy?.trim() && !!personal.setAt?.trim();
    return {
      systolicBelow: personal.systolicBelow,
      diastolicBelow: personal.diastolicBelow,
      confirmed,
      source: confirmed ? "clinician" : "starting_suggestion",
      setBy: confirmed ? personal.setBy : null,
      setAt: confirmed ? personal.setAt : null,
    };
  }
  return {
    systolicBelow: suggestion.systolicBelow,
    diastolicBelow: suggestion.diastolicBelow,
    confirmed: false,
    source: "starting_suggestion",
    setBy: null,
    setAt: null,
  };
}

/**
 * "not_above" is deliberately not "within": the band has an upper limit only, so
 * a very low reading is also "not_above". The word "in range" or "on target"
 * must never be shown from this status. Hypotension is not judged here (it has no
 * confirmed threshold; the spec's low-BP rules belong to S11/S12), and low
 * readings reach the care team through the existing red-flag path, not this label.
 */
export type BandStatus = "not_above" | "above";

/** A reading (or a day mean) against the band's upper limits. Either number at or above its limit is "above"; anything else is only "not above", never "within range". */
export function bandStatus(systolic: number, diastolic: number, band: TargetBand): BandStatus {
  return systolic >= band.systolicBelow || diastolic >= band.diastolicBelow ? "above" : "not_above";
}

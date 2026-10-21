import { PROPOSED_CONFIG, type BiomarkerBand, type BiomarkerBands, type BiomarkerRange } from "@tarragon/shared";
import { positionInLabRange, unitKey, type TrendPoint } from "./trend";

/**
 * Tarragon's Good / Acceptable / Needs-attention grade for one result (founder decision 2026-10-20).
 *
 * Rules that keep it safe:
 *  - bands come only from the versioned `biomarkers.grade_bands` config and only once the CMO has CONFIRMED it. While it is
 *    `proposed`, `activeBiomarkerBands()` is null and no grade is shown;
 *  - a band applies only when the result's unit matches the band's unit. Nothing is converted;
 *  - the laboratory's own flag can only make a grade WORSE, never better: a Tarragon "good" under a lab "high" or "low" flag shows as
 *    acceptable, and a lab critical flag always shows needs attention.
 */
export type BiomarkerGrade = "good" | "acceptable" | "needs_attention";

const RANK: Record<BiomarkerGrade, number> = { good: 0, acceptable: 1, needs_attention: 2 };

/** The latest CMO-CONFIRMED version of a config key, or null. A newer proposed version never switches a confirmed one off. */
export function latestConfirmedConfig<T>(key: string): T | null {
  const today = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
  const confirmed = PROPOSED_CONFIG.filter((e) => e.key === key && e.status === "confirmed" && e.effectiveFrom <= today).sort((a, b) => b.version - a.version);
  return confirmed.length > 0 ? (confirmed[0].value as unknown as T) : null;
}

/** The CMO-confirmed bands, or null while the config is still a proposal. */
export function activeBiomarkerBands(): BiomarkerBands | null {
  return latestConfirmedConfig<BiomarkerBands>("biomarkers.grade_bands");
}

/** Any lab flag that starts with "critical" (the labs' own spelling varies: critical, critical_low, critical_high). */
export function isCriticalFlag(flag: string | null | undefined): boolean {
  return typeof flag === "string" && flag.startsWith("critical");
}

/** Normalises µ/μ/u and spacing so "µmol/L" and "umol/L" compare equal. Never converts between units. */
function normUnit(unit: string | null): string {
  return unitKey(unit).replace(/[µμ]/g, "u").replace(/²/g, "2").replace(/\^2/g, "2").replace(/\s+/g, "");
}

function inRange(v: number, r: BiomarkerRange): boolean {
  return (r.min === null || v >= r.min) && (r.max === null || v <= r.max);
}

function worse(a: BiomarkerGrade, b: BiomarkerGrade): BiomarkerGrade {
  return RANK[a] >= RANK[b] ? a : b;
}

export function gradeResult(
  code: string,
  point: Pick<TrendPoint, "value" | "unit" | "flag" | "refLow" | "refHigh">,
  bands: BiomarkerBands | null = activeBiomarkerBands(),
): BiomarkerGrade | null {
  const band = bands?.analytes[code];
  if (!band || normUnit(band.unit) !== normUnit(point.unit)) return null;
  let grade: BiomarkerGrade = inRange(point.value, band.good) ? "good" : inRange(point.value, band.acceptable) ? "acceptable" : "needs_attention";
  if (isCriticalFlag(point.flag)) return "needs_attention";
  if (point.flag === "low" || point.flag === "high" || positionInLabRange(point) === "below" || positionInLabRange(point) === "above") {
    grade = worse(grade, "acceptable");
  }
  return grade;
}

export type RangeBarSegment = { grade: BiomarkerGrade; from: number; to: number };
export type RangeBarModel = { segments: RangeBarSegment[]; marker: number; scaleMin: number; scaleMax: number };

/**
 * Where a value sits on a bar made from a band, as 0..100 percentages. An open end of the band is drawn as a stretch a quarter of the
 * finite span wide, so the bar never implies a hard edge the band does not have. The marker is clamped to the bar.
 */
export function rangeBarModel(value: number, band: BiomarkerBand): RangeBarModel {
  const finite = [band.good.min, band.good.max, band.acceptable.min, band.acceptable.max].filter((n): n is number => n !== null);
  const lo = Math.min(...finite, value);
  const hi = Math.max(...finite, value);
  const span = Math.max(...finite) - Math.min(...finite);
  const pad = Math.max(span * 0.25, 0.5);
  // An outlier (a unit slip) must not squash the band: the axis stretches at most two band-spans past it, and the marker pins to the edge.
  const cap = Math.max(span, 1) * 2;
  const scaleMin = band.acceptable.min === null ? lo - pad : Math.max(Math.min(band.acceptable.min, value), band.acceptable.min - cap) - pad * (value < band.acceptable.min ? 0.2 : 1);
  const scaleMax = band.acceptable.max === null ? hi + pad : Math.min(Math.max(band.acceptable.max, value), band.acceptable.max + cap) + pad * (value > band.acceptable.max ? 0.2 : 1);
  const pct = (n: number) => ((n - scaleMin) / (scaleMax - scaleMin)) * 100;
  const aMin = band.acceptable.min ?? scaleMin;
  const aMax = band.acceptable.max ?? scaleMax;
  const gMin = band.good.min ?? aMin;
  const gMax = band.good.max ?? aMax;
  const cuts: RangeBarSegment[] = [
    { grade: "needs_attention", from: 0, to: pct(aMin) },
    { grade: "acceptable", from: pct(aMin), to: pct(gMin) },
    { grade: "good", from: pct(gMin), to: pct(gMax) },
    { grade: "acceptable", from: pct(gMax), to: pct(aMax) },
    { grade: "needs_attention", from: pct(aMax), to: 100 },
  ];
  const segments = cuts.filter((s) => s.to - s.from > 0.01).map((s) => ({ ...s, from: Math.max(0, s.from), to: Math.min(100, s.to) }));
  return { segments, marker: Math.min(100, Math.max(0, pct(value))), scaleMin, scaleMax };
}

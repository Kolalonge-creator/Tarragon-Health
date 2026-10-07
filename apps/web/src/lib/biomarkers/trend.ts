/**
 * Multi-year biomarker trends (S43, spec 2.5): the pure half.
 *
 * Rules this file keeps, because they are the safety of the feature:
 *  - the reference range drawn or described is ALWAYS the one the laboratory sent
 *    with that result. There is no "optimal" range, no tighter band, no range
 *    this code or this company decided on;
 *  - a target is only ever labelled as the care team's target, and only when the
 *    database says an active care plan set it;
 *  - results reported in different units are never joined into one line and are
 *    never converted: they are grouped by unit and each group is drawn alone;
 *  - the screen says how a result moved, never what it means.
 */

export interface TrendPoint {
  takenAt: string;
  value: number;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  flag: string | null;
  source: "lab_result" | "legacy_report" | string;
  laboratory: string | null;
}

export interface TrendTarget {
  min: number | null;
  max: number | null;
  condition: string | null;
}

export interface TrendSeries {
  code: string;
  points: TrendPoint[];
  unitMixed: boolean;
  target: TrendTarget | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Reads the database's answer. Anything malformed is dropped, never repaired. */
export function parseTrend(json: unknown): TrendSeries | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const rawPoints = Array.isArray(j.points) ? j.points : [];
  const points: TrendPoint[] = [];
  for (const p of rawPoints) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const value = num(r.value);
    const takenAt = str(r.taken_at);
    if (value === null || !takenAt || Number.isNaN(new Date(takenAt).getTime())) continue;
    points.push({
      takenAt,
      value,
      unit: str(r.unit),
      refLow: num(r.ref_low),
      refHigh: num(r.ref_high),
      refText: str(r.ref_text),
      flag: str(r.flag),
      source: str(r.source) ?? "lab_result",
      laboratory: str(r.laboratory),
    });
  }
  points.sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
  let target: TrendTarget | null = null;
  const t = j.target;
  if (t && typeof t === "object") {
    const r = t as Record<string, unknown>;
    // only a care team target is ever shown as a target
    if (r.set_by === "care_team") {
      const min = num(r.min);
      const max = num(r.max);
      if (min !== null || max !== null) target = { min, max, condition: str(r.condition) };
    }
  }
  return { code: typeof j.code === "string" ? j.code : "", points, unitMixed: j.unit_mixed === true, target };
}

export function unitKey(unit: string | null): string {
  return (unit ?? "").trim().toLowerCase();
}

/** One group per reported unit, in order of first appearance. Never converts. */
export function groupByUnit(points: readonly TrendPoint[]): { unit: string | null; points: TrendPoint[] }[] {
  const groups = new Map<string, { unit: string | null; points: TrendPoint[] }>();
  for (const p of points) {
    const k = unitKey(p.unit);
    const g = groups.get(k);
    if (g) g.points.push(p);
    else groups.set(k, { unit: p.unit, points: [p] });
  }
  return [...groups.values()];
}

/** The laboratory's own range for this result, in words. Null when the lab sent none. */
export function labRangeLabel(p: Pick<TrendPoint, "refLow" | "refHigh" | "refText">): string | null {
  if (p.refText) return p.refText;
  if (p.refLow !== null && p.refHigh !== null) return `${p.refLow} to ${p.refHigh}`;
  if (p.refHigh !== null) return `up to ${p.refHigh}`;
  if (p.refLow !== null) return `${p.refLow} or more`;
  return null;
}

export function targetLabel(t: TrendTarget): string {
  if (t.min !== null && t.max !== null) return `${t.min} to ${t.max}`;
  if (t.max !== null) return `${t.max} or less`;
  return `${t.min} or more`;
}

/** Where a value sits against THE LAB'S range for that result. Unknown when the lab sent no numeric range. */
export function positionInLabRange(p: Pick<TrendPoint, "value" | "refLow" | "refHigh">): "within" | "below" | "above" | "unknown" {
  if (p.refLow === null && p.refHigh === null) return "unknown";
  if (p.refLow !== null && p.value < p.refLow) return "below";
  if (p.refHigh !== null && p.value > p.refHigh) return "above";
  return "within";
}

/** A readable name for a lab code. Known short forms keep their usual casing. */
export function displayCode(code: string): string {
  const upper = new Set(["ldl", "hdl", "hba1c", "egfr", "alt", "ast", "psa", "tsh", "crp", "esr", "hiv"]);
  const words = code.replace(/[_-]+/g, " ").trim();
  if (upper.has(words.toLowerCase())) {
    const w = words.toLowerCase();
    return w === "hba1c" ? "HbA1c" : w === "egfr" ? "eGFR" : w.toUpperCase();
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ChartGeometry {
  width: number;
  height: number;
  path: string;
  dots: { x: number; y: number; point: TrendPoint }[];
  /** The lab's range band, only when every point in the group carries the same numeric range. */
  band: { y1: number; y2: number } | null;
  /** The care team's target band, only when set and the group is in one unit. */
  targetBand: { y1: number; y2: number } | null;
  yMin: number;
  yMax: number;
}

/**
 * Pure SVG geometry for one single-unit group. The lab's range band is drawn only
 * when all points share one range (a changed range, which happens when a lab
 * changes method, would make a single band misleading, so none is drawn and the
 * table below carries each result's own range). The target band is drawn only for
 * a group whose unit matches the target's, which this function cannot know, so the
 * caller passes `target` only for the group it belongs to.
 */
export function chartGeometry(points: readonly TrendPoint[], target: TrendTarget | null, width = 320, height = 160): ChartGeometry | null {
  if (points.length === 0) return null;
  const pad = { l: 8, r: 8, t: 10, b: 10 };
  const sameRange = points.every((p) => p.refLow === points[0].refLow && p.refHigh === points[0].refHigh);
  const range = sameRange && (points[0].refLow !== null || points[0].refHigh !== null) ? { lo: points[0].refLow, hi: points[0].refHigh } : null;

  const candidates: number[] = points.map((p) => p.value);
  if (range?.lo !== null && range?.lo !== undefined) candidates.push(range.lo);
  if (range?.hi !== null && range?.hi !== undefined) candidates.push(range.hi);
  if (target?.min !== null && target?.min !== undefined) candidates.push(target.min);
  if (target?.max !== null && target?.max !== undefined) candidates.push(target.max);
  let yMin = Math.min(...candidates);
  let yMax = Math.max(...candidates);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const span = yMax - yMin;
  yMin -= span * 0.08;
  yMax += span * 0.08;

  const t0 = new Date(points[0].takenAt).getTime();
  const t1 = new Date(points[points.length - 1].takenAt).getTime();
  const tSpan = t1 - t0;
  const x = (iso: string, i: number) => {
    if (points.length === 1) return width / 2;
    if (tSpan <= 0) return pad.l + ((width - pad.l - pad.r) * i) / (points.length - 1);
    return pad.l + ((new Date(iso).getTime() - t0) / tSpan) * (width - pad.l - pad.r);
  };
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (height - pad.t - pad.b);

  const dots = points.map((p, i) => ({ x: x(p.takenAt, i), y: y(p.value), point: p }));
  const path = dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(" ");
  const bandOf = (lo: number | null | undefined, hi: number | null | undefined) => ({
    y1: y(hi ?? yMax),
    y2: y(lo ?? yMin),
  });
  return {
    width,
    height,
    path,
    dots,
    band: range ? bandOf(range.lo, range.hi) : null,
    targetBand: target && (target.min !== null || target.max !== null) ? bandOf(target.min, target.max) : null,
    yMin,
    yMax,
  };
}

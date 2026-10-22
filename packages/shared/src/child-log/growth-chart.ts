import { GROWTH_BAND_SHAPE, type GrowthBand } from "./growth-bands";

/**
 * Pure layout for the child growth chart (S68b), shared by the web SVG and the phone's react-native-svg so the two draw the same picture.
 * One marker per measurement. The marker's SHAPE says the band (circle, diamond, triangle) and the screen prints the WORD beside it; colour is
 * only ever a third cue. kg and cm only. The chart draws the child's own points and nothing else: no percentile curve is invented here.
 */
export interface ChartPointInput {
  readonly id: string;
  readonly ageMonths: number;
  readonly value: number;
  /** Null when the database could not read the point against the reference. It is drawn as a plain square so it is never mistaken for a band. */
  readonly band: GrowthBand | null;
}

export type MarkerShape = "circle" | "diamond" | "triangle" | "square";

export interface ChartMarker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly shape: MarkerShape;
  readonly band: GrowthBand | null;
  readonly value: number;
  readonly ageMonths: number;
}

export interface ChartLayout {
  readonly width: number;
  readonly height: number;
  readonly markers: readonly ChartMarker[];
  /** The line joining the points in age order, as "x,y x,y". Empty for fewer than two points. */
  readonly polyline: string;
  readonly xTicks: readonly { readonly at: number; readonly label: string }[];
  readonly yTicks: readonly { readonly at: number; readonly label: string }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.0001; v += step) out.push(round1(v));
  return out;
}

export function layoutGrowthChart(
  points: readonly ChartPointInput[],
  size: { readonly width: number; readonly height: number; readonly pad?: number },
): ChartLayout {
  const pad = size.pad ?? 32;
  const sorted = [...points].filter((p) => Number.isFinite(p.ageMonths) && Number.isFinite(p.value)).sort((a, b) => a.ageMonths - b.ageMonths);
  if (sorted.length === 0) return { width: size.width, height: size.height, markers: [], polyline: "", xTicks: [], yTicks: [] };
  const xs = sorted.map((p) => p.ageMonths);
  const ys = sorted.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yLo = Math.min(...ys);
  const yHi = Math.max(...ys);
  const yTicks = niceTicks(yLo - (yHi - yLo) * 0.1, yHi + (yHi - yLo) * 0.1 + (yHi === yLo ? 1 : 0), 5);
  const yMin = Math.min(...yTicks);
  const yMax = Math.max(...yTicks);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const px = (a: number) => round1(pad + ((a - xMin) / xSpan) * (size.width - pad * 2));
  const py = (v: number) => round1(size.height - pad - ((v - yMin) / ySpan) * (size.height - pad * 2));
  const markers = sorted.map((p): ChartMarker => ({
    id: p.id, x: px(p.ageMonths), y: py(p.value), shape: p.band ? GROWTH_BAND_SHAPE[p.band] : "square", band: p.band, value: p.value, ageMonths: p.ageMonths,
  }));
  const xTickValues = xMax === xMin ? [xMin] : niceTicks(xMin, xMax, 5).filter((t) => t >= xMin - 0.0001 && t <= xMax + 0.0001);
  return {
    width: size.width,
    height: size.height,
    markers,
    polyline: markers.length >= 2 ? markers.map((m) => `${m.x},${m.y}`).join(" ") : "",
    xTicks: xTickValues.map((t) => ({ at: px(t), label: String(round1(t)) })),
    yTicks: yTicks.map((t) => ({ at: py(t), label: String(t) })),
  };
}

/** SVG path for a marker centred on (x, y) with radius r. Square, circle, diamond and triangle are distinguishable without colour. */
export function markerPath(shape: MarkerShape, x: number, y: number, r: number): string {
  switch (shape) {
    case "circle":
      return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
    case "diamond":
      return `M ${x} ${y - r * 1.2} L ${x + r * 1.2} ${y} L ${x} ${y + r * 1.2} L ${x - r * 1.2} ${y} Z`;
    case "triangle":
      return `M ${x} ${y - r * 1.2} L ${x + r * 1.15} ${y + r} L ${x - r * 1.15} ${y + r} Z`;
    case "square":
      return `M ${x - r} ${y - r} L ${x + r} ${y - r} L ${x + r} ${y + r} L ${x - r} ${y + r} Z`;
  }
}

/** Age in months from a date of birth and a measurement date, one decimal. */
export function ageInMonths(dateOfBirth: string, measuredAt: string): number {
  const days = (Date.parse(measuredAt) - Date.parse(`${dateOfBirth.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, Math.round((days / 30.4375) * 10) / 10);
}

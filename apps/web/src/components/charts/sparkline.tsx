/**
 * A single-series trend line for a stat tile (2026-11-06: big numbers and charts on the patient dashboard). One series, so no
 * legend: the tile's label names it. A 2px line in brand green on the tile's own surface, the latest point marked, no axes or
 * grid. The shape is the message; the number beside it is the value. Screen readers get a one-line description instead.
 */
export interface SparkPoint {
  /** Time, ms. */
  t: number;
  v: number;
}

export function sparkPath(points: readonly SparkPoint[], width: number, height: number, pad = 3): { d: string; last: { x: number; y: number } } | null {
  if (points.length < 2) return null;
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  const x = (t: number) => (t1 === t0 ? width / 2 : pad + ((t - t0) / (t1 - t0)) * (width - 2 * pad));
  // A flat series sits in the middle rather than on the floor.
  const y = (v: number) => (v1 === v0 ? height / 2 : height - pad - ((v - v0) / (v1 - v0)) * (height - 2 * pad));
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const d = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const lastPoint = sorted[sorted.length - 1]!;
  return { d, last: { x: x(lastPoint.t), y: y(lastPoint.v) } };
}

export function Sparkline({ points, label, className }: { points: readonly SparkPoint[]; label: string; className?: string }) {
  const W = 120;
  const H = 32;
  const path = sparkPath(points, W, H);
  if (!path) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className={className ?? "h-8 w-full"} preserveAspectRatio="none">
      <path d={path.d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={path.last.x} cy={path.last.y} r={3} fill="currentColor" />
    </svg>
  );
}

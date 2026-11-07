/**
 * A single-series trend line for a stat tile (2026-11-06: big numbers and charts on the patient dashboard). One series, so no
 * legend: the tile's label names it. A 2px line in brand green on the tile's own surface, the latest point marked, no axes or
 * grid. The shape is the message; the number beside it is the value. Screen readers get a one-line description instead.
 */
import { sparkPath, type SparkPoint } from "@tarragon/shared";

/** The point type and path maths live in @tarragon/shared (reading-trends.ts), shared with the phone app. */
export { sparkPath, type SparkPoint };

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

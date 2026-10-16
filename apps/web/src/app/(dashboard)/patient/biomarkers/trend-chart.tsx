import { t } from "@tarragon/i18n";
import { chartGeometry, displayCode, labRangeLabel, targetLabel, type TrendPoint, type TrendTarget } from "@/lib/biomarkers/trend";

/**
 * One single-unit line. The shaded band is the laboratory's own range (drawn only
 * when every point shares one); the dashed band is the care team's target. Both are
 * labelled in words under the chart, and every point is also in the table next to
 * it, so the chart is never the only way to read a result.
 */
export function TrendChart({ code, unit, points, target }: { code: string; unit: string | null; points: TrendPoint[]; target: TrendTarget | null }) {
  const g = chartGeometry(points, target);
  if (!g) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const range = g.band ? labRangeLabel(first) : null;
  const summary = `${displayCode(code)}, ${points.length} result${points.length === 1 ? "" : "s"}${unit ? ` in ${unit}` : ""}, from ${new Date(first.takenAt).getFullYear()} to ${new Date(last.takenAt).getFullYear()}`;
  return (
    <figure>
      <svg viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={summary} className="h-auto w-full max-w-md">
        <title>{summary}</title>
        {g.band && <rect x={0} width={g.width} y={Math.min(g.band.y1, g.band.y2)} height={Math.abs(g.band.y2 - g.band.y1)} className="fill-brand-green/10" />}
        {g.targetBand && (
          <rect x={0} width={g.width} y={Math.min(g.targetBand.y1, g.targetBand.y2)} height={Math.abs(g.targetBand.y2 - g.targetBand.y1)} className="fill-none stroke-clinical-navy" strokeDasharray="4 3" />
        )}
        <path d={g.path} className="fill-none stroke-brand-green" strokeWidth={2} />
        {g.dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={3.5} className="fill-brand-green" />
        ))}
      </svg>
      <figcaption className="mt-1 space-y-0.5 text-xs text-charcoal-ink/65 dark:text-night-ink/65">
        {range && <p>{t("biomarkers.chart.range", "en", { range })}</p>}
        {target && g.targetBand && <p>{t("biomarkers.chart.target", "en", { range: targetLabel(target) })}</p>}
      </figcaption>
    </figure>
  );
}

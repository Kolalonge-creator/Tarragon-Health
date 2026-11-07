import Link from "next/link";
import type { PeriodTrend } from "@tarragon/shared";

/**
 * One executive indicator. The value is a plain number, or the honest words when it is unknown; `detail` carries the
 * numerator and denominator for a rate; `definition` says exactly what is counted, so no figure needs guessing.
 * Trend wording is brand-toned and neutral: a rise in registrations and a rise in incidents are not both "good".
 */
export function KpiCard({
  label,
  value,
  detail,
  trend,
  definition,
  href,
}: {
  label: string;
  value: number | string | null;
  detail?: string;
  trend?: PeriodTrend | null;
  definition: string;
  href: string;
}) {
  const unknown = value === null;
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-charcoal-ink/5 transition hover:ring-brand-green/40 focus-visible:outline-2 focus-visible:outline-brand-green"
    >
      <span className="text-sm font-medium text-charcoal-ink/70">{label}</span>
      <span className={unknown ? "mt-1 text-sm font-medium text-charcoal-ink/60" : "mt-1 font-heading text-3xl font-semibold tabular-nums text-charcoal-ink"}>
        {unknown ? "Could not be loaded" : typeof value === "number" ? value.toLocaleString("en-NG") : value}
      </span>
      {detail && <span className="text-sm text-charcoal-ink/75">{detail}</span>}
      {trend && (
        <span className="mt-1 text-xs text-charcoal-ink/60">
          <span aria-hidden>{trend.direction === "up" ? "▲ " : trend.direction === "down" ? "▼ " : "■ "}</span>
          {trend.text}
        </span>
      )}
      <span className="mt-auto pt-3 text-xs leading-snug text-charcoal-ink/50">{definition}</span>
    </Link>
  );
}

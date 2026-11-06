import type { LucideIcon } from "lucide-react";
import { Sparkline, type SparkPoint } from "@/components/charts/sparkline";
import { cn } from "@/lib/utils";

/**
 * A pinned Home tile as a big number (founder, 2026-11-06, chosen in a prompt): the label, the value large with its unit, when
 * it was taken and which way it has moved this month in words, and a 30-day trend line. Every word is in text ink, never in
 * the chart's colour; the trend word is never coloured either, because "higher" is not "worse" for every reading.
 *
 * `empty` replaces the value with a muted hint (never a dash); `chart` is any small chart (the trend line, or the doses bars).
 */
export function BigNumberTile({
  icon: Icon,
  label,
  value,
  unit,
  detail,
  status,
  points,
  chartLabel,
  chart,
  empty,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  unit?: string;
  /** One short line under the value: "Today, 08:10 · Steady this month". */
  detail?: string | null;
  /** A clinical status line (BP band), in the status palette, from the caller. */
  status?: { text: string; className: string } | null;
  /** The 30-day series for the trend line; fewer than two points draws no line. */
  points?: readonly SparkPoint[];
  chartLabel?: string;
  chart?: React.ReactNode;
  empty?: string;
}) {
  const hasLine = points !== undefined && points.length >= 2;
  return (
    <div className="flex h-full flex-col gap-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm sm:p-5 dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft-sage dark:bg-brand-green/20">
          <Icon className="h-4 w-4 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
        </span>
        <p className="text-sm font-medium text-charcoal-ink/70 dark:text-night-ink/70">{label}</p>
      </div>
      {empty !== undefined || value === undefined ? (
        <p className="py-2 text-base text-charcoal-ink/55 dark:text-night-ink/60">{empty ?? "No reading yet"}</p>
      ) : (
        <p className="font-heading text-4xl font-semibold leading-none tracking-tight break-words text-charcoal-ink sm:text-5xl dark:text-night-ink">
          {value}
          {unit && (
            <span className="ml-1.5 whitespace-nowrap font-sans text-base font-normal tracking-normal text-charcoal-ink/55 dark:text-night-ink/60">
              {unit}
            </span>
          )}
        </p>
      )}
      {status && <p className={cn("text-xs font-medium", status.className)}>{status.text}</p>}
      {detail && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{detail}</p>}
      {(hasLine || chart) && (
        <div className="mt-auto pt-1 text-brand-green dark:text-brand-green-bright">
          {chart ?? <Sparkline points={points!} label={chartLabel ?? `${label}, last 30 days`} />}
          {hasLine && !chart && <p className="mt-0.5 text-[11px] text-charcoal-ink/45 dark:text-night-ink/50">Last 30 days</p>}
        </div>
      )}
    </div>
  );
}

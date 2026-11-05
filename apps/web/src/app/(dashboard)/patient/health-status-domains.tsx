"use client";

import {
  HEALTH_STATUS_DISCLAIMER,
  healthStatusWord,
  INDICATOR_FLAG_WORDS,
  trendWords,
  type HealthStatusDomain,
  type HealthStatusIndicator,
} from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";
import { formatPatientDate } from "@/lib/format-date";

const dateText = (iso: string) => formatPatientDate(iso, { day: "numeric", month: "short", year: "numeric" });

function IndicatorRow({ i }: { i: HealthStatusIndicator }) {
  const outside = i.flag === "above" || i.flag === "below";
  const trend = trendWords(i, dateText);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-charcoal-ink/10 py-1.5 first:border-t-0 dark:border-night-ink/15">
      <span className="text-sm text-charcoal-ink dark:text-night-ink">{i.label}</span>
      <span className="text-sm font-medium tabular-nums text-charcoal-ink dark:text-night-ink">
        {i.value}
        {i.unit ? ` ${i.unit}` : ""}
      </span>
      <span className="w-full text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        {dateText(i.at)}
        {i.rangeText ? ` · range ${i.rangeText}` : ""}
        {" · "}
        <span className={outside ? "font-medium text-charcoal-ink dark:text-night-ink" : undefined}>{INDICATOR_FLAG_WORDS[i.flag]}</span>
        {trend ? ` · ${trend}` : ""}
      </span>
    </li>
  );
}

function DomainBlock({ d }: { d: HealthStatusDomain }) {
  const variant = d.status === "worth_discussing" ? ("amber" as const) : d.status === "within_range" ? ("green" as const) : ("grey" as const);
  return (
    <div className="rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{d.label}</p>
        <Badge variant={variant}>{healthStatusWord(d)}</Badge>
      </div>
      <p className="mt-0.5 text-xs text-charcoal-ink/50 dark:text-night-ink/55">{d.blurb}</p>
      {d.indicators.length > 0 && (
        <ul className="mt-2">
          {d.indicators.map((i) => (
            <IndicatorRow key={i.key} i={i} />
          ))}
        </ul>
      )}
      {d.actions.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
          {d.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * T2-06: the per-domain health status (results against their own printed range or the person's own target, the direction since last
 * time, and what is outstanding). No number score. Rendered inside HealthDomainsCard and on /patient/health-score.
 */
export function HealthStatusDomains({ domains }: { domains: HealthStatusDomain[] }) {
  if (domains.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {domains.map((d) => (
          <DomainBlock key={d.key} d={d} />
        ))}
      </div>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{HEALTH_STATUS_DISCLAIMER}</p>
    </div>
  );
}

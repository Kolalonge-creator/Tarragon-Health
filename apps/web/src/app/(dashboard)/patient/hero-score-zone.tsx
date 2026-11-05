"use client";

import Link from "next/link";
import { HEALTH_STATUS_WORDS, healthStatusSummary } from "@tarragon/shared";
import { useHealthStatusDomains } from "@/lib/queries/health-status";

/**
 * "How you're doing", the status half of the Overview hero band. T2-06 (founder, 2026-11-04): the composite Health Score number is no
 * longer shown anywhere a patient looks; this zone summarises health status BY DOMAIN instead (how many areas are tracked, which are worth
 * discussing), with the detail one tap away. The old score rows stay in patient_risk_scores as history; nothing here reads them.
 *
 * Status colours are the clinical system, which is why this zone sits on a white panel and never on the band's brand-green action zone.
 */
export function HeroScoreZone({ patientId, eyebrow }: { patientId: string; eyebrow: string }) {
  const { data, isLoading, isError } = useHealthStatusDomains(patientId);
  const domains = data ?? [];
  const summary = healthStatusSummary(domains);

  return (
    <div className="flex flex-col justify-center gap-2.5 bg-white dark:bg-night-card p-6 sm:p-8">
      <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{eyebrow}</p>
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
        How you&apos;re doing
      </p>

      {isLoading && (
        <div aria-hidden className="space-y-3 py-1">
          <div className="h-6 w-56 animate-pulse rounded-lg bg-charcoal-ink/[0.07] dark:bg-night-ink/10" />
          <div className="h-4 w-full animate-pulse rounded-full bg-charcoal-ink/[0.07] dark:bg-night-ink/10" />
        </div>
      )}

      {!isLoading && isError && (
        <p className="max-w-sm text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Your health by area is taking a moment to load. It will be back the next time this page refreshes.
        </p>
      )}

      {!isLoading && !isError && !summary && (
        <p className="max-w-sm text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Your health by area appears here after your first result, blood pressure or weight reading.
        </p>
      )}

      {summary && (
        <>
          <p className="text-base font-medium text-charcoal-ink dark:text-night-ink">{summary}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {domains.map((d) => (
              <li key={d.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${d.status === "worth_discussing" ? "bg-amber-500" : d.status === "within_range" ? "bg-green-500" : "bg-charcoal-ink/30"}`}
                />
                {d.label}: {HEALTH_STATUS_WORDS[d.status].toLowerCase()}
              </li>
            ))}
          </ul>
          <Link href="/patient/health-score" className="text-sm font-medium text-brand-green underline-offset-2 hover:underline">
            See your health by area
          </Link>
          <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">This does not replace a doctor&apos;s assessment.</p>
        </>
      )}
    </div>
  );
}

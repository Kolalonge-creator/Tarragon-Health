"use client";

import { useLatestHealthScore } from "@/lib/queries/health-score";
import type { HealthScoreRiskLevel } from "@/lib/rules/health-score";
import { HEALTH_STATUS_WORD, HEALTH_STATUS_METER } from "@/components/health-status-banner";

/**
 * "How you're doing" — the score half of the Overview hero band. The one
 * display-scale figure on the page (the Score details card lower down keeps
 * only a small chip). Client-side because the score comes from
 * useLatestHealthScore; the band around it stays a server component.
 *
 * Status colours here are the clinical green/amber/red system, which is why
 * this zone sits on a white panel and never on the band's brand-green
 * action zone — the two colour systems must not mix on one surface.
 */
export function HeroScoreZone({ patientId, eyebrow }: { patientId: string; eyebrow: string }) {
  const { data, isLoading, isError } = useLatestHealthScore(patientId);

  const hasScore = !isLoading && !isError && !!data && typeof data.score === "number";
  const riskLevel =
    hasScore && data?.risk_level ? (data.risk_level as HealthScoreRiskLevel) : null;
  const status = riskLevel ? HEALTH_STATUS_WORD[riskLevel] : null;
  const meter = riskLevel ? HEALTH_STATUS_METER[riskLevel] : null;

  return (
    <div className="flex flex-col justify-center gap-2.5 bg-white p-6 sm:p-8">
      <p className="text-sm text-charcoal-ink/60">{eyebrow}</p>
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
        How you&apos;re doing
      </p>

      {isLoading && (
        <div aria-hidden className="space-y-3 py-1">
          <div className="h-12 w-36 animate-pulse rounded-lg bg-charcoal-ink/[0.07]" />
          <div className="h-2.5 w-full animate-pulse rounded-full bg-charcoal-ink/[0.07]" />
        </div>
      )}

      {!isLoading && isError && (
        <p className="max-w-sm text-sm text-charcoal-ink/70">
          Your Health Score is taking a moment to load. It will be back the next time this page
          refreshes.
        </p>
      )}

      {!isLoading && !isError && !hasScore && (
        // A brand-new patient has no score yet — an honest invitation, never
        // a fake number or a fabricated status word.
        <p className="max-w-sm text-sm text-charcoal-ink/70">
          Log your first readings and your score appears here. It builds from the everyday
          numbers you already track.
        </p>
      )}

      {hasScore && data && typeof data.score === "number" && (
        <>
          {/* Proportional figures on purpose — display numbers never use
              tabular-nums. */}
          <p className="font-heading text-5xl font-semibold text-charcoal-ink sm:text-6xl">
            {data.score}
            <span className="ml-1.5 align-baseline text-lg font-normal text-charcoal-ink/50">
              /100
            </span>
          </p>
          {status && (
            <p className="flex items-center gap-2 text-sm font-medium text-charcoal-ink">
              <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden />
              {status.word}
            </p>
          )}
          {meter && (
            <div
              role="meter"
              aria-label="Health Score"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={data.score}
              className={`h-2.5 w-full overflow-hidden rounded-full ${meter.track}`}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${meter.fill}`}
                style={{ width: `${Math.min(100, Math.max(0, data.score))}%` }}
              />
            </div>
          )}
          <p className="text-xs text-charcoal-ink/50">
            A summary of your recent numbers, not a diagnosis.
          </p>
        </>
      )}
    </div>
  );
}

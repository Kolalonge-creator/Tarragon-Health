"use client";

import Link from "next/link";
import { useLatestHealthScore, useHealthScoreHistory } from "@/lib/queries/health-score";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import {
  getHealthScoreTips,
  getPriorityHealthScoreTip,
  computeHealthScoreTrend,
  describeHealthScoreTrend,
  type HealthScoreComponent,
  type HealthScoreRiskLevel,
} from "@/lib/rules/health-score";
import { RISK_LEVEL_RING } from "@/lib/rules/risk-level-style";
import { HEALTH_SCORE_COMPONENT_LABEL } from "@/lib/rules/health-score-labels";

import { formatPatientDate } from "@/lib/format-date";
// Clinical-dashboard status colours (green/amber/red) — a separate system
// from brand colour, per CLAUDE.md. Matches risk-assessment-display.tsx's
// low/moderate/high convention, extended with very_high.
const RISK_LEVEL_BADGE: Record<HealthScoreRiskLevel, { variant: "green" | "amber" | "red"; label: string }> = {
  low: { variant: "green", label: "On track" },
  moderate: { variant: "amber", label: "Room to improve" },
  high: { variant: "red", label: "Needs attention" },
  very_high: { variant: "red", label: "Needs urgent attention" },
};

/**
 * "Score details" — the breakdown behind the hero band's Health Score. The hero
 * (hero-score-zone.tsx) still owns the page's first/biggest figure (a large number +
 * bar meter, reached before any scrolling); this card is a second, deliberately
 * smaller visual of the same score — a compact ring rather than another giant number,
 * so the two don't read as duplicate hero moments on one page. The full trend line
 * chart lives one tap away on /patient/health-score (health-score-trend-client.tsx),
 * matching the same two-tier pattern biological-age-card.tsx already uses for its own
 * ring-card -> full-graph-page split. Uses the shared ScoreRing component and
 * RISK_LEVEL_RING tokens so both cards render as one visual system.
 */
export function HealthScoreCard({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useLatestHealthScore(patientId);
  const { data: history } = useHealthScoreHistory(patientId);
  const components = (data?.inputs as { components?: HealthScoreComponent[] } | null)?.components ?? [];
  const priorityTip = getPriorityHealthScoreTip(components);
  const tips = getHealthScoreTips(components).filter((tip) => tip !== priorityTip?.tip);
  const scoredHistory = history?.filter(
    (h): h is { score: number; inputs: typeof h.inputs; computed_at: string } => h.score !== null,
  );
  const trend = scoredHistory ? computeHealthScoreTrend(scoredHistory) : null;
  const riskLevel = data?.risk_level as HealthScoreRiskLevel | null;
  const badgeStyle = riskLevel ? RISK_LEVEL_BADGE[riskLevel] : null;
  const ringColorVar = riskLevel ? RISK_LEVEL_RING[riskLevel] : RISK_LEVEL_RING.low;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
          Score details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600 dark:text-red-300">Could not load your Health Score.</p>}
        {!isLoading && !isError && !data && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Log a reading or finish your risk assessment to get your first Health Score.
          </p>
        )}
        {data && badgeStyle && (
          <>
            <div className="flex flex-col items-center gap-3">
              <ScoreRing value={data.score ?? 0} colorVar={ringColorVar} size={120} strokeWidth={10}>
                <span className="font-heading text-[32px] font-semibold leading-none tracking-tight text-charcoal-ink dark:text-night-ink">
                  {data.score}
                </span>
                <span className="mt-0.5 text-[11px] font-medium text-charcoal-ink/55 dark:text-night-ink/55">
                  out of 100
                </span>
              </ScoreRing>
              <Badge variant={badgeStyle.variant}>{badgeStyle.label}</Badge>
            </div>
            <p className="text-center text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              A non-diagnostic summary of a few everyday habits and numbers we already have on
              file, not a medical diagnosis. Updated {formatPatientDate(data.computed_at)}.
            </p>
            {trend && (
              <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
                {describeHealthScoreTrend(trend)}
              </p>
            )}
            <Link
              href="/patient/health-score"
              className="flex items-center justify-between text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
            >
              See your trend over time
              <NAV_ICON.chevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </Link>
            {components.length > 0 && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                {components.map((component, index) => {
                  const isLastOdd = components.length % 2 === 1 && index === components.length - 1;
                  return (
                    <div
                      key={component.key}
                      className={`flex flex-col gap-0.5 rounded-lg bg-warm-ivory dark:bg-night-ink/10 px-3 py-2.5 ${
                        isLastOdd ? "col-span-2" : ""
                      }`}
                    >
                      <span className="text-[11px] text-charcoal-ink/55 dark:text-night-ink/55">
                        {HEALTH_SCORE_COMPONENT_LABEL[component.key]}
                      </span>
                      <span className="text-[17px] font-semibold text-charcoal-ink dark:text-night-ink">
                        {Math.round(component.value)}
                        <span className="text-[11px] font-medium text-charcoal-ink/40 dark:text-night-ink/40">
                          /100
                        </span>
                      </span>
                      {component.detail && (
                        <span className="text-[11px] text-charcoal-ink/50 dark:text-night-ink/50">
                          {component.detail}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {priorityTip && (
              <div className="space-y-1 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3">
                <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
                  Start here for the biggest lift
                </p>
                <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
                  {priorityTip.tip}
                </p>
              </div>
            )}
            {tips.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
                  {priorityTip ? "Other things that could help" : "A few things that could help"}
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                  {tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

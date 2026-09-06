"use client";

import { useLatestHealthScore, useHealthScoreHistory } from "@/lib/queries/health-score";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  getHealthScoreTips,
  getPriorityHealthScoreTip,
  computeHealthScoreTrend,
  describeHealthScoreTrend,
  type HealthScoreComponent,
  type HealthScoreRiskLevel,
} from "@/lib/rules/health-score";

import { formatPatientDate } from "@/lib/format-date";
// Clinical-dashboard status colors (green/amber/red) — a separate system
// from brand color, per CLAUDE.md. Matches risk-assessment-display.tsx's
// low/moderate/high convention, extended with very_high.
const RISK_LEVEL_BADGE: Record<HealthScoreRiskLevel, { variant: "green" | "amber" | "red"; label: string }> = {
  low: { variant: "green", label: "On track" },
  moderate: { variant: "amber", label: "Room to improve" },
  high: { variant: "red", label: "Needs attention" },
  very_high: { variant: "red", label: "Needs urgent attention" },
};

const COMPONENT_LABEL: Record<HealthScoreComponent["key"], string> = {
  bp_control: "Blood pressure control",
  hba1c: "HbA1c",
  screening_compliance: "Screening compliance",
  vaccination: "Vaccinations",
  bmi: "Weight (BMI)",
  smoking: "Smoking",
};

/**
 * "Score details" — the breakdown behind the hero band's Health Score: what
 * feeds it, how it has moved, and where the biggest lift is. The hero
 * (hero-score-zone.tsx) owns the display-scale figure and the meter; this
 * card deliberately carries only a small inline chip so the page never shows
 * two hero numbers for the same score.
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
        {data && (
          <>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-warm-ivory dark:bg-night-ink/10 px-2 py-0.5 text-sm font-semibold text-charcoal-ink dark:text-night-ink">
                {data.score}/100
              </span>
              {data.risk_level && (
                <Badge variant={RISK_LEVEL_BADGE[data.risk_level as HealthScoreRiskLevel].variant}>
                  {RISK_LEVEL_BADGE[data.risk_level as HealthScoreRiskLevel].label}
                </Badge>
              )}
            </div>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              A non-diagnostic summary of a few everyday habits and numbers we already have on
              file, not a medical diagnosis. Updated {formatPatientDate(data.computed_at)}.
            </p>
            {trend && (
              <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
                {describeHealthScoreTrend(trend)}
              </p>
            )}
            {components.length > 0 && (
              <ul className="space-y-1 pt-2 text-sm text-charcoal-ink dark:text-night-ink">
                {components.map((component) => (
                  <li key={component.key} className="flex items-center justify-between">
                    <span>{COMPONENT_LABEL[component.key]}</span>
                    <span className="text-charcoal-ink/60 dark:text-night-ink/60">
                      {component.detail && `${component.detail} · `}
                      {Math.round(component.value)}/100
                    </span>
                  </li>
                ))}
              </ul>
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

"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useLatestHealthScore, useHealthScoreHistory } from "@/lib/queries/health-score";
import {
  computeHealthScoreTrend,
  describeHealthScoreTrend,
  getHealthScoreTips,
  getPriorityHealthScoreTip,
  type HealthScoreComponent,
  type HealthScoreRiskLevel,
} from "@/lib/rules/health-score";
import { RISK_LEVEL_RING } from "@/lib/rules/risk-level-style";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";
import { HealthScoreComponentGrid } from "@/components/health-score-component-grid";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const SCORE_CONFIG: ChartConfig = {
  score: { label: "Health Score", color: "var(--color-brand-green)" },
};

const RISK_LEVEL_BADGE: Record<
  HealthScoreRiskLevel,
  { variant: "green" | "amber" | "red"; label: string }
> = {
  low: { variant: "green", label: "On track" },
  moderate: { variant: "amber", label: "Room to improve" },
  high: { variant: "red", label: "Needs attention" },
  very_high: { variant: "red", label: "Needs urgent attention" },
};

function formatDate(computedAt: string): string {
  return new Date(computedAt).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export function HealthScoreTrendClient({ patientId }: { patientId: string }) {
  const { data: latest, isLoading: isLatestLoading, isError: isLatestError } =
    useLatestHealthScore(patientId);
  const { data: history, isLoading: isHistoryLoading, isError: isHistoryError } =
    useHealthScoreHistory(patientId);

  const isLoading = isLatestLoading || isHistoryLoading;
  const isError = isLatestError || isHistoryError;

  const scoredHistory = (history ?? []).filter(
    (h): h is { score: number; inputs: typeof h.inputs; computed_at: string } => h.score !== null,
  );
  const points = scoredHistory.map((h) => ({ date: formatDate(h.computed_at), score: h.score }));

  const trend = scoredHistory.length >= 2 ? computeHealthScoreTrend(scoredHistory) : null;
  const trendLine = trend ? describeHealthScoreTrend(trend) : null;

  const scores = points.map((p) => p.score);
  const yDomain: [number, number] | undefined =
    scores.length > 0 ? [Math.max(0, Math.min(...scores) - 5), Math.min(100, Math.max(...scores) + 5)] : undefined;

  const riskLevel = latest?.risk_level as HealthScoreRiskLevel | null;
  const badgeStyle = riskLevel ? RISK_LEVEL_BADGE[riskLevel] : null;
  const ringColorVar = riskLevel ? RISK_LEVEL_RING[riskLevel] : RISK_LEVEL_RING.low;

  const components =
    (latest?.inputs as { components?: HealthScoreComponent[] } | null)?.components ?? [];
  const priorityTip = getPriorityHealthScoreTip(components);
  const tips = getHealthScoreTips(components).filter((tip) => tip !== priorityTip?.tip);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-600 dark:text-red-300">Could not load your Health Score.</p>
          )}
          {!isLoading && !isError && !latest && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              Log a reading or finish your risk assessment to get your first Health Score.
            </p>
          )}
          {!isLoading && !isError && latest && badgeStyle && (
            <div className="flex flex-col items-center gap-3">
              <ScoreRing value={latest.score ?? 0} colorVar={ringColorVar}>
                <span className="font-heading text-[42px] font-semibold leading-none tracking-tight text-charcoal-ink dark:text-night-ink">
                  {latest.score}
                </span>
                <span className="mt-0.5 text-[13px] font-medium text-charcoal-ink/55 dark:text-night-ink/55">
                  out of 100
                </span>
              </ScoreRing>
              <Badge variant={badgeStyle.variant}>{badgeStyle.label}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Over time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoading && !isError && points.length < 2 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              {points.length === 0
                ? "Not enough check-ins yet to show a trend. Come back after your next monthly check-in."
                : `You've logged one score so far (${points[0].score}/100). We'll start charting your trend after your next monthly check-in.`}
            </p>
          )}

          {trendLine && (
            <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
              {trendLine}
            </p>
          )}

          {points.length >= 2 && (
            <ChartContainer config={SCORE_CONFIG}>
              <LineChart data={points}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} domain={yDomain ?? [0, 100]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="score" stroke="var(--color-score)" dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
          )}

          <p className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Recalculated monthly from your latest vitals, screening records, and (when you have
            them) your care team&apos;s reviewed lab results — a non-diagnostic summary, not a
            medical diagnosis.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What&apos;s behind your score</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <HealthScoreComponentGrid components={components} columns={3} />

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
        </CardContent>
      </Card>
    </div>
  );
}

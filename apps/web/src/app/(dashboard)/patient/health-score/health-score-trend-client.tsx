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
import { HEALTH_SCORE_COMPONENT_LABEL } from "@/lib/rules/health-score-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroMetric } from "@/components/ui/hero-metric";
import { formatPatientDate } from "@/lib/format-date";
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

  const components =
    (latest?.inputs as { components?: HealthScoreComponent[] } | null)?.components ?? [];
  const priorityTip = getPriorityHealthScoreTip(components);
  const tips = getHealthScoreTips(components).filter((tip) => tip !== priorityTip?.tip);

  return (
    <div className="space-y-4">
      {isError ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-red-600 dark:bg-night-card dark:text-red-300">
          We couldn&apos;t load your Health Score just now. Try again in a moment.
        </p>
      ) : (
        <HeroMetric
          label="Health Score"
          value={isLoading ? "–" : latest ? latest.score : null}
          unit={latest ? "out of 100" : undefined}
          status={badgeStyle ?? undefined}
          caption={
            latest
              ? (trendLine ?? "This is your first score. It moves as you log new readings.")
              : undefined
          }
          meta={latest ? `Updated ${formatPatientDate(latest.computed_at)}` : undefined}
          emptyText="Your score appears after your next blood pressure or weight reading. It builds from the everyday numbers you already track."
        />
      )}

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
            Recalculated monthly from your latest vitals and screening records. A non-diagnostic
            summary of a few everyday habits and numbers we already have on file — not a medical
            diagnosis.
          </p>
        </CardContent>
      </Card>

      {components.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s behind your score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {components.map((component, index) => {
                const isLastOdd =
                  components.length % 2 === 1 &&
                  index === components.length - 1 &&
                  components.length % 3 !== 0;
                return (
                  <div
                    key={component.key}
                    className={`flex flex-col gap-0.5 rounded-lg bg-warm-ivory dark:bg-night-ink/10 px-3 py-2.5 ${
                      isLastOdd ? "col-span-2 sm:col-span-1" : ""
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
      )}
    </div>
  );
}

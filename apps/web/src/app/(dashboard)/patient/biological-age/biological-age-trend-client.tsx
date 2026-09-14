"use client";

import Link from "next/link";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { useLatestHealthScore, useHealthScoreHistory } from "@/lib/queries/health-score";
import { usePatientChronologicalAge } from "@/lib/queries/patient-demographics";
import {
  computeHealthScoreTrend,
  getPriorityHealthScoreTip,
  getHealthScoreTips,
  type HealthScoreComponent,
  type HealthScoreRiskLevel,
} from "@/lib/rules/health-score";
import { computeBiologicalAge, describeBiologicalAgeTrend } from "@/lib/rules/biological-age";
import { RISK_LEVEL_RING } from "@/lib/rules/risk-level-style";
import { HEALTH_SCORE_COMPONENT_LABEL } from "@/lib/rules/health-score-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const AGE_CONFIG: ChartConfig = {
  estimated_age: { label: "Biological age (yrs)", color: "var(--color-brand-green)" },
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

export function BiologicalAgeTrendClient({ patientId }: { patientId: string }) {
  const { data: latest, isLoading: isLatestLoading, isError: isLatestError } =
    useLatestHealthScore(patientId);
  const { data: history, isLoading: isHistoryLoading, isError: isHistoryError } =
    useHealthScoreHistory(patientId);
  const { data: chronologicalAge, isLoading: isAgeLoading } =
    usePatientChronologicalAge(patientId);

  const isLoading = isLatestLoading || isHistoryLoading || isAgeLoading;
  const isError = isLatestError || isHistoryError;

  const scoredHistory = (history ?? []).filter(
    (h): h is { score: number; inputs: typeof h.inputs; computed_at: string } => h.score !== null,
  );
  const points =
    chronologicalAge != null
      ? scoredHistory.map((h) => ({
          date: formatDate(h.computed_at),
          estimated_age: computeBiologicalAge(chronologicalAge, h.score).estimatedAge,
        }))
      : [];

  const trend = scoredHistory.length >= 2 ? computeHealthScoreTrend(scoredHistory) : null;
  const trendLine =
    trend && chronologicalAge != null ? describeBiologicalAgeTrend(trend, chronologicalAge) : null;

  const ages = points.map((p) => p.estimated_age);
  const yValues = chronologicalAge != null ? [...ages, chronologicalAge] : ages;
  const yDomain: [number, number] | undefined =
    yValues.length > 0 ? [Math.min(...yValues) - 2, Math.max(...yValues) + 2] : undefined;

  const riskLevel = latest?.risk_level as HealthScoreRiskLevel | null;
  const badgeStyle = riskLevel ? RISK_LEVEL_BADGE[riskLevel] : null;
  const ringColorVar = riskLevel ? RISK_LEVEL_RING[riskLevel] : RISK_LEVEL_RING.low;
  const estimate =
    latest?.score != null && chronologicalAge != null
      ? computeBiologicalAge(chronologicalAge, latest.score)
      : null;

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
            <p className="text-sm text-red-600 dark:text-red-300">Could not load your Biological Age.</p>
          )}
          {!isLoading && !isError && chronologicalAge == null && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              We need your date of birth to estimate this — add it to your{" "}
              <Link href="/patient/profile" className="text-brand-green dark:text-brand-green-bright hover:underline">
                profile
              </Link>
              .
            </p>
          )}
          {!isLoading && !isError && chronologicalAge != null && !latest && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              Log a reading or finish your risk assessment to see your first Biological Age
              estimate.
            </p>
          )}
          {!isLoading && !isError && estimate && badgeStyle && (
            <div className="flex flex-col items-center gap-3">
              <ScoreRing value={latest?.score ?? 0} colorVar={ringColorVar}>
                <span className="font-heading text-[42px] font-semibold leading-none tracking-tight text-charcoal-ink dark:text-night-ink">
                  {estimate.estimatedAge}
                </span>
                <span className="mt-0.5 text-[13px] font-medium text-charcoal-ink/55 dark:text-night-ink/55">
                  yrs, estimated
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
          {!isLoading && !isError && chronologicalAge != null && points.length < 2 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              {points.length === 0
                ? "Not enough check-ins yet to show a trend. Come back after your next monthly check-in."
                : `You've logged one check so far (${points[0].estimated_age} years). We'll start charting your trend after your next monthly check-in.`}
            </p>
          )}

          {trendLine && (
            <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
              {trendLine}
            </p>
          )}

          {points.length >= 2 && (
            <ChartContainer config={AGE_CONFIG}>
              <LineChart data={points}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} domain={yDomain ?? ["dataMin - 2", "dataMax + 2"]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {chronologicalAge != null && (
                  <ReferenceLine
                    y={chronologicalAge}
                    stroke="rgba(23,23,23,0.35)"
                    strokeDasharray="4 4"
                    label={{
                      value: `Birth age · ${chronologicalAge}`,
                      fontSize: 11,
                      position: "insideTopRight",
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="estimated_age"
                  stroke="var(--color-estimated_age)"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ChartContainer>
          )}

          <p className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Recalculated monthly from your latest vitals and screening records — the same Health
            Score shown elsewhere on your dashboard, reframed as an age. Not a lab-based or genetic
            biological-age test, and not a medical diagnosis.
          </p>
        </CardContent>
      </Card>

      {components.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s behind your estimate</CardTitle>
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

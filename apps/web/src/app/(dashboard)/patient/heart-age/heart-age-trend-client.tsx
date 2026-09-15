"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { useLatestHeartAge, useHeartAgeHistory } from "@/lib/queries/heart-age";
import { usePatientChronologicalAge } from "@/lib/queries/patient-demographics";
import { computeHeartAgeTrend, describeHeartAgeTrend } from "@/lib/rules/heart-age";
import { RISK_LEVEL_RING } from "@/lib/rules/risk-level-style";
import type { HealthScoreRiskLevel } from "@/lib/rules/health-score";
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
  heart_age: { label: "Heart age (yrs)", color: "var(--color-brand-green)" },
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

export function HeartAgeTrendClient({ patientId }: { patientId: string }) {
  const { data: latest, isLoading: isLatestLoading, isError: isLatestError } =
    useLatestHeartAge(patientId);
  const { data: history, isLoading: isHistoryLoading, isError: isHistoryError } =
    useHeartAgeHistory(patientId);
  const { data: chronologicalAge, isLoading: isAgeLoading } =
    usePatientChronologicalAge(patientId);

  const isLoading = isLatestLoading || isHistoryLoading || isAgeLoading;
  const isError = isLatestError || isHistoryError;

  const scoredHistory = (history ?? []).filter(
    (h): h is { score: number; computed_at: string } => h.score !== null,
  );
  const points = scoredHistory.map((h) => ({
    date: formatDate(h.computed_at),
    heart_age: h.score,
  }));

  const trend = history ? computeHeartAgeTrend(history) : null;
  const trendLine = trend ? describeHeartAgeTrend(trend) : null;

  const ages = points.map((p) => p.heart_age);
  const yValues = chronologicalAge != null ? [...ages, chronologicalAge] : ages;
  const yDomain: [number, number] | undefined =
    yValues.length > 0 ? [Math.min(...yValues) - 2, Math.max(...yValues) + 2] : undefined;

  const heartAgeYears = latest?.score ?? null;
  const riskLevel = latest?.risk_level as HealthScoreRiskLevel | null;
  const badgeStyle = riskLevel ? RISK_LEVEL_BADGE[riskLevel] : null;
  const ringColorVar = riskLevel ? RISK_LEVEL_RING[riskLevel] : RISK_LEVEL_RING.low;
  // See heart-age-card.tsx's comment: the ring's fill is "more fill =
  // better" (ScoreRing's established convention), driven by the inverse of
  // the risk percentage rather than the raw age-in-years value.
  const cvdRiskPct = latest?.inputs?.cvd_risk_10yr_percent ?? null;
  const ringFillValue = cvdRiskPct != null ? Math.max(0, Math.min(100, 100 - cvdRiskPct)) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-600 dark:text-red-300">Could not load your Heart Age.</p>
          )}
          {!isLoading && !isError && heartAgeYears == null && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              We&apos;ll show a Heart Age once you have a cholesterol panel and blood pressure/smoking
              status on file.
            </p>
          )}
          {!isLoading && !isError && heartAgeYears != null && badgeStyle && (
            <div className="flex flex-col items-center gap-3">
              <ScoreRing value={ringFillValue ?? 0} colorVar={ringColorVar}>
                <span className="font-heading text-[42px] font-semibold leading-none tracking-tight text-charcoal-ink dark:text-night-ink">
                  {heartAgeYears}
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
          {!isLoading && !isError && points.length < 2 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              {points.length === 0
                ? "Not enough cholesterol panels yet to show a trend."
                : `You've logged one Heart Age so far (${points[0].heart_age} years). We'll start charting your trend after your next cholesterol panel.`}
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
                      value: `Actual age · ${chronologicalAge}`,
                      fontSize: 11,
                      position: "insideTopRight",
                    }}
                  />
                )}
                <Line type="monotone" dataKey="heart_age" stroke="var(--color-heart_age)" dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
          )}

          <p className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Recalculated each time you have a new cholesterol panel recorded — the age at which
            someone with ideal blood pressure and cholesterol would carry the same 10-year
            cardiovascular risk your own results show. Not a lab-based or genetic biological-age
            test, and not a medical diagnosis. 10-year CVD risk is estimated with SCORE2
            (European-derived) and is not validated for Sub-Saharan African populations; treat it
            as a guide and confirm clinically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

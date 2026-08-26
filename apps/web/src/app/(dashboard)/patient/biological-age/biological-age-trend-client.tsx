"use client";

import Link from "next/link";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { useHealthScoreHistory } from "@/lib/queries/health-score";
import { usePatientChronologicalAge } from "@/lib/queries/patient-demographics";
import { computeHealthScoreTrend } from "@/lib/rules/health-score";
import { computeBiologicalAge, describeBiologicalAgeTrend } from "@/lib/rules/biological-age";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const AGE_CONFIG: ChartConfig = {
  estimated_age: { label: "Biological age (yrs)", color: "var(--color-brand-green)" },
};

function formatDate(computedAt: string): string {
  return new Date(computedAt).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export function BiologicalAgeTrendClient({ patientId }: { patientId: string }) {
  const { data: history, isLoading: isHistoryLoading, isError } = useHealthScoreHistory(patientId);
  const { data: chronologicalAge, isLoading: isAgeLoading } =
    usePatientChronologicalAge(patientId);

  const isLoading = isHistoryLoading || isAgeLoading;

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
  const trendLine = trend && chronologicalAge != null
    ? describeBiologicalAgeTrend(trend, chronologicalAge)
    : null;

  const ages = points.map((p) => p.estimated_age);
  const yValues = chronologicalAge != null ? [...ages, chronologicalAge] : ages;
  const yDomain: [number, number] | undefined =
    yValues.length > 0 ? [Math.min(...yValues) - 2, Math.max(...yValues) + 2] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Over time</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load your trend.</p>}

        {!isLoading && !isError && chronologicalAge == null && (
          <p className="text-sm text-charcoal-ink/60">
            We need your date of birth to estimate this — add it to your{" "}
            <Link href="/patient/profile" className="text-brand-green hover:underline">
              profile
            </Link>
            .
          </p>
        )}

        {!isLoading && !isError && chronologicalAge != null && points.length < 2 && (
          <p className="text-sm text-charcoal-ink/60">
            {points.length === 0
              ? "Not enough check-ins yet to show a trend. Come back after your next monthly check-in."
              : `You've logged one check so far (${points[0].estimated_age} years). We'll start charting your trend after your next monthly check-in.`}
          </p>
        )}

        {trendLine && (
          <p className="rounded-md bg-soft-sage px-3 py-2 text-sm text-deep-forest">
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

        <p className="border-t border-charcoal-ink/10 pt-3 text-xs text-charcoal-ink/60">
          Recalculated monthly from your latest vitals and screening records. A non-diagnostic
          summary of a few everyday habits and numbers we already have on file — not a medical
          diagnosis.
        </p>
      </CardContent>
    </Card>
  );
}

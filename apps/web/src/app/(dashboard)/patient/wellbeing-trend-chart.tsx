"use client";

import { useState, type Key as ReactKey } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useWellbeingTrend, type WellbeingTrendPoint } from "@/lib/queries/wellbeing";
import { bandHigherIsBetter, bandLowerIsBetter, wellbeingBandLabel, type WellbeingBand } from "@/lib/wellbeing/banding";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatPatientDate } from "@/lib/format-date";

type WellbeingTrendMode = "mood_score" | "stress_score" | "sleep_quality";

const MODE_CONFIG: Record<
  WellbeingTrendMode,
  { label: string; color: string; band: (score: number) => WellbeingBand }
> = {
  mood_score: { label: "Mood", color: "var(--chart-analytics-1)", band: bandHigherIsBetter },
  stress_score: { label: "Stress", color: "var(--chart-analytics-5)", band: bandLowerIsBetter },
  sleep_quality: { label: "Sleep", color: "var(--chart-analytics-4)", band: bandHigherIsBetter },
};

function formatDate(checkedInAt: string): string {
  return formatPatientDate(checkedInAt, { month: "short", day: "numeric" });
}

const GRID_PROPS = { vertical: false, stroke: "var(--chart-grid)" } as const;
const AXIS_TICK = { fontSize: 12, fill: "var(--chart-tick)" } as const;
const LINE_PROPS = {
  type: "monotone",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type EndpointDotProps = { key?: ReactKey | null; cx?: number; cy?: number; index?: number; value?: number };

/** Dot + value label at the line's last point only, matching VitalsTrendChart
 * (vitals-trend-chart.tsx) — every other point renders nothing, hover still
 * shows the tooltip. */
function makeEndpointDot(lastIndex: number, color: string) {
  return function EndpointDot({ key, cx, cy, index, value }: EndpointDotProps) {
    if (index !== lastIndex || cx == null || cy == null || value == null) {
      return <g key={key} />;
    }
    return (
      <g key={key}>
        <circle
          cx={cx}
          cy={cy}
          r={4.5}
          fill={color}
          strokeWidth={2}
          className="stroke-white dark:stroke-night-card"
        />
        <text
          x={cx - 8}
          y={cy - 9}
          textAnchor="end"
          fontSize={12}
          fontWeight={600}
          className="fill-charcoal-ink dark:fill-night-ink"
        >
          {value}
        </text>
      </g>
    );
  };
}

/**
 * Mood/stress/sleep trend chart (Module 46) — the same 1-5 self-report scale
 * as the dashboard tiles (wellbeing-tiles.tsx) and check-in form, plotted
 * over the last 90 days so a patient can see the direction of travel rather
 * than only today's snapshot. Purely descriptive, same as the tiles: this is
 * engagement telemetry (see banding.ts's header) and never feeds
 * escalation/risk scoring.
 */
export function WellbeingTrendChart({ patientId }: { patientId: string }) {
  const [mode, setMode] = useState<WellbeingTrendMode>("mood_score");
  const { data, isLoading, isError } = useWellbeingTrend(patientId);
  const points = (data ?? []).map((row) => ({ ...row, date: formatDate(row.checked_in_at) }));
  const lastIndex = points.length - 1;
  const config = MODE_CONFIG[mode];
  const chartConfig: ChartConfig = { [mode]: { label: config.label, color: config.color } };
  const latest: (WellbeingTrendPoint & { date: string }) | undefined = points[lastIndex];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wellbeing trend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MODE_CONFIG) as WellbeingTrendMode[]).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={mode === key ? "default" : "outline"}
              onClick={() => setMode(key)}
            >
              {MODE_CONFIG[key].label}
            </Button>
          ))}
        </div>

        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">Could not load the trend chart.</p>
        )}
        {!isLoading && !isError && points.length < 2 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Log a few more check-ins to see your trend over time.
          </p>
        )}
        {points.length >= 2 && (
          <div className="space-y-2">
            <ChartContainer config={chartConfig}>
              <LineChart data={points}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  domain={[1, 5]}
                  tickCount={5}
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  {...LINE_PROPS}
                  dataKey={mode}
                  stroke={`var(--color-${mode})`}
                  dot={makeEndpointDot(lastIndex, config.color)}
                />
              </LineChart>
            </ChartContainer>
            {latest && (
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                Latest: {latest[mode]}/5 ({wellbeingBandLabel(config.band(latest[mode]))})
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

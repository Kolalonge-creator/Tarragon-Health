"use client";

import { useState, type Key as ReactKey } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useVitalsTrend, useHba1cTrend, useBmiTrend, useLatestHeightCm } from "@/lib/queries/vitals";
import { getHba1cBracket } from "@/lib/rules/hba1c-bracket";
import { bmiCategory, type BmiCategory } from "@/lib/obesity/classify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

import { formatPatientDate } from "@/lib/format-date";
/** Warm, non-clinical framing — same patient-facing wording as the public
 * BMI calculator's CATEGORY_COPY (bmi-calorie-calculator.tsx), never the
 * doctor-facing "obesity_class_i" style labels used in the clinician panel. */
const BMI_CATEGORY_LABEL: Record<BmiCategory, string> = {
  underweight: "Underweight range",
  healthy: "Healthy weight range",
  overweight: "Overweight range",
  obesity_class_i: "Higher weight range",
  obesity_class_ii: "Higher weight range",
  obesity_class_iii: "Higher weight range",
};

/* Series colours reference the bare --chart-* vars (not the :root-resolved
 * --color-chart-* aliases) so they re-resolve inside the data-theme="dark"
 * subtree and flip automatically in Night mode. */
const BP_CONFIG: ChartConfig = {
  systolic: { label: "Systolic (mmHg)", color: "var(--chart-systolic)" },
  diastolic: { label: "Diastolic (mmHg)", color: "var(--chart-diastolic)" },
};

const GLUCOSE_CONFIG: ChartConfig = {
  glucose_mmol_l: { label: "Glucose (mmol/L)", color: "var(--chart-glucose)" },
};

const HBA1C_CONFIG: ChartConfig = {
  value: { label: "HbA1c (%)", color: "var(--chart-glucose)" },
};

const WEIGHT_CONFIG: ChartConfig = {
  weight_kg: { label: "Weight (kg)", color: "var(--chart-glucose)" },
};

const PULSE_CONFIG: ChartConfig = {
  pulse_bpm: { label: "Heart rate (bpm)", color: "var(--chart-systolic)" },
};

const BMI_CONFIG: ChartConfig = {
  bmi: { label: "BMI", color: "var(--chart-glucose)" },
};

function formatDate(taken_at: string): string {
  return formatPatientDate(taken_at, { month: "short", day: "numeric" });
}

// Recessive horizontal gridlines: 1px solid, one step off the surface.
// --chart-grid carries its own alpha (0.08 light / 0.10 dark) and flips
// with the theme, so no separate strokeOpacity.
const GRID_PROPS = {
  vertical: false,
  stroke: "var(--chart-grid)",
} as const;

// Small axis labels in text tokens, no axis/tick strokes competing with the
// gridlines. --chart-tick carries its own alpha (0.5 light / 0.55 dark).
const AXIS_TICK = { fontSize: 12, fill: "var(--chart-tick)" } as const;

// 2px series lines with round joins/caps, shared by every mode below.
const LINE_PROPS = {
  type: "monotone",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type EndpointDotProps = {
  key?: ReactKey | null;
  cx?: number;
  cy?: number;
  index?: number;
  value?: number;
};

/**
 * Dot + direct value label at a line's endpoint only — every other point
 * renders nothing (hover still gets the tooltip). The label stays in text
 * tokens, never the series hue; for BP the systolic label sits above its dot
 * and the diastolic label below, so close endpoints cannot collide.
 */
function makeEndpointDot(lastIndex: number, color: string, placement: "above" | "below") {
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
          y={placement === "above" ? cy - 9 : cy + 17}
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

type TrendMode = "blood_pressure" | "glucose" | "weight" | "pulse" | "hba1c" | "bmi";

export function VitalsTrendChart({ patientId }: { patientId: string }) {
  const [mode, setMode] = useState<TrendMode>("blood_pressure");
  const vitalsTrend = useVitalsTrend(
    patientId,
    mode === "hba1c" || mode === "bmi" ? "blood_pressure" : mode
  );
  const hba1cTrend = useHba1cTrend(patientId);
  const bmiTrend = useBmiTrend(patientId);
  const heightQuery = useLatestHeightCm(patientId);
  const { data, isLoading, isError } =
    mode === "hba1c" ? hba1cTrend : mode === "bmi" ? bmiTrend : vitalsTrend;
  const points = (data ?? []).map((reading) => ({ ...reading, date: formatDate(reading.taken_at) }));
  const lastIndex = points.length - 1;
  const noHeightOnFile = mode === "bmi" && !heightQuery.isLoading && heightQuery.data == null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trends</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={mode === "blood_pressure" ? "default" : "outline"}
            onClick={() => setMode("blood_pressure")}
          >
            Blood pressure
          </Button>
          <Button
            size="sm"
            variant={mode === "glucose" ? "default" : "outline"}
            onClick={() => setMode("glucose")}
          >
            Glucose
          </Button>
          <Button
            size="sm"
            variant={mode === "weight" ? "default" : "outline"}
            onClick={() => setMode("weight")}
          >
            Weight
          </Button>
          <Button
            size="sm"
            variant={mode === "pulse" ? "default" : "outline"}
            onClick={() => setMode("pulse")}
          >
            Heart rate
          </Button>
          <Button
            size="sm"
            variant={mode === "hba1c" ? "default" : "outline"}
            onClick={() => setMode("hba1c")}
          >
            HbA1c
          </Button>
          <Button size="sm" variant={mode === "bmi" ? "default" : "outline"} onClick={() => setMode("bmi")}>
            BMI
          </Button>
        </div>

        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">Could not load the trend chart.</p>
        )}
        {mode === "bmi" && !isLoading && !isError && noHeightOnFile && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Add your height in your{" "}
            <a href="/patient/prevention#risk-assessment" className="underline">
              risk assessment
            </a>{" "}
            to see your BMI trend alongside your weight.
          </p>
        )}
        {!isLoading && !isError && !noHeightOnFile && points.length < 2 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Not enough readings yet.</p>
        )}
        {points.length >= 2 && mode === "blood_pressure" && (
          <div className="space-y-2">
            <ChartContainer config={BP_CONFIG}>
              <LineChart data={points}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickCount={4}
                  domain={["dataMin - 10", "dataMax + 10"]}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  {...LINE_PROPS}
                  dataKey="systolic"
                  stroke="var(--color-systolic)"
                  dot={makeEndpointDot(lastIndex, "var(--chart-systolic)", "above")}
                />
                <Line
                  {...LINE_PROPS}
                  dataKey="diastolic"
                  stroke="var(--color-diastolic)"
                  dot={makeEndpointDot(lastIndex, "var(--chart-diastolic)", "below")}
                />
              </LineChart>
            </ChartContainer>
            {/* Legend only for the one multi-series metric — the selector
                buttons already name the single-series charts. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
              {(["systolic", "diastolic"] as const).map((seriesKey) => (
                <span key={seriesKey} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: BP_CONFIG[seriesKey].color }}
                  />
                  {BP_CONFIG[seriesKey].label}
                </span>
              ))}
            </div>
          </div>
        )}
        {points.length >= 2 && mode === "glucose" && (
          <ChartContainer config={GLUCOSE_CONFIG}>
            <LineChart data={points}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickCount={4}
                domain={["dataMin - 1", "dataMax + 1"]}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                {...LINE_PROPS}
                dataKey="glucose_mmol_l"
                stroke="var(--color-glucose_mmol_l)"
                dot={makeEndpointDot(lastIndex, "var(--chart-glucose)", "above")}
              />
            </LineChart>
          </ChartContainer>
        )}
        {points.length >= 2 && mode === "weight" && (
          <ChartContainer config={WEIGHT_CONFIG}>
            <LineChart data={points}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickCount={4}
                domain={["dataMin - 2", "dataMax + 2"]}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                {...LINE_PROPS}
                dataKey="weight_kg"
                stroke="var(--color-weight_kg)"
                dot={makeEndpointDot(lastIndex, "var(--chart-glucose)", "above")}
              />
            </LineChart>
          </ChartContainer>
        )}
        {points.length >= 2 && mode === "pulse" && (
          <ChartContainer config={PULSE_CONFIG}>
            <LineChart data={points}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickCount={4}
                domain={["dataMin - 10", "dataMax + 10"]}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                {...LINE_PROPS}
                dataKey="pulse_bpm"
                stroke="var(--color-pulse_bpm)"
                dot={makeEndpointDot(lastIndex, "var(--chart-systolic)", "above")}
              />
            </LineChart>
          </ChartContainer>
        )}
        {points.length >= 2 && mode === "hba1c" && (
          <div className="space-y-2">
            <ChartContainer config={HBA1C_CONFIG}>
              <LineChart data={points}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickCount={4}
                  domain={["dataMin - 0.5", "dataMax + 0.5"]}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  {...LINE_PROPS}
                  dataKey="value"
                  stroke="var(--color-value)"
                  dot={makeEndpointDot(lastIndex, "var(--chart-glucose)", "above")}
                />
              </LineChart>
            </ChartContainer>
            {(() => {
              const latest = points[points.length - 1] as { value: number };
              const bracket = getHba1cBracket(latest.value);
              return (
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  Latest: {latest.value}% ({bracket.label})
                </p>
              );
            })()}
          </div>
        )}
        {points.length >= 2 && mode === "bmi" && !noHeightOnFile && (
          <div className="space-y-2">
            <ChartContainer config={BMI_CONFIG}>
              <LineChart data={points}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickCount={4}
                  domain={["dataMin - 1", "dataMax + 1"]}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  {...LINE_PROPS}
                  dataKey="bmi"
                  stroke="var(--color-bmi)"
                  dot={makeEndpointDot(lastIndex, "var(--chart-glucose)", "above")}
                />
              </LineChart>
            </ChartContainer>
            {(() => {
              const latest = points[points.length - 1] as { bmi: number };
              return (
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  Latest: {latest.bmi.toFixed(1)} ({BMI_CATEGORY_LABEL[bmiCategory(latest.bmi)]})
                </p>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

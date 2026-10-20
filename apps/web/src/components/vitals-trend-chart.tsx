"use client";
import {
  bandCaption,
  glucoseInDisplayUnit,
  glucoseTrendBand,
  GLUCOSE_UNIT_LABEL,
  weightTrendBand,
  type GlucoseDisplayUnit,
} from "@tarragon/shared";
import { useGlucoseUnit } from "@/components/glucose-unit-provider";
import { DEFAULT_LOCALE, t } from "@tarragon/i18n";

import { useState, type Key as ReactKey } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from "recharts";
import { useVitalsTrend, useHba1cTrend, useBmiTrend, useHeightStatus, useTrendBandsEligible } from "@/lib/queries/vitals";
import { getHba1cBracket } from "@/lib/rules/hba1c-bracket";
import { bmiCategory, type BmiCategory } from "@/lib/obesity/classify";
import { HeightDiscrepancyBanner } from "@/components/height-discrepancy-banner";
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

/** The plotted glucose series is converted into the reader's own unit, so the
 * config (which supplies the axis/tooltip label) has to be built per-unit
 * rather than being a module constant like the others. The series key stays
 * `glucose_display` in both cases so the Line/colour wiring is unit-agnostic. */
function glucoseConfig(unit: GlucoseDisplayUnit): ChartConfig {
  return {
    glucose_display: {
      label: `Glucose (${GLUCOSE_UNIT_LABEL[unit]})`,
      color: "var(--chart-glucose)",
    },
  };
}

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
  const glucoseUnit = useGlucoseUnit();
  const [mode, setMode] = useState<TrendMode>("blood_pressure");
  const vitalsTrend = useVitalsTrend(
    patientId,
    mode === "hba1c" || mode === "bmi" ? "blood_pressure" : mode
  );
  const hba1cTrend = useHba1cTrend(patientId);
  const bmiTrend = useBmiTrend(patientId);
  const heightStatus = useHeightStatus(patientId);
  const { data, isLoading, isError, error } =
    mode === "hba1c" ? hba1cTrend : mode === "bmi" ? bmiTrend : vitalsTrend;
  // A refusal (not on the care team) is not a load failure and must not read as an empty chart (INV-10).
  const notAvailable = isError && error instanceof Error && error.message.includes("not available to you");
  // Readings arrive in mmol/L (what vitals_readings stores) and are plotted in
  // the reader's own unit. Converting here rather than at the axis keeps the
  // tooltip, the dot labels and the axis all reporting the same number.
  const points = (data ?? []).map((reading) => ({
    ...reading,
    date: formatDate(reading.taken_at),
    glucose_display:
      "glucose_mmol_l" in reading && typeof reading.glucose_mmol_l === "number"
        ? glucoseInDisplayUnit(reading.glucose_mmol_l, glucoseUnit)
        : null,
  }));
  const lastIndex = points.length - 1;
  // S07y: a point that was taken at a pharmacy or clinic machine, or copied from a paper diary, is plotted like any other and SAYS so below the chart.
  const originOf = (p: unknown): string | null => {
    const v = (p as { entry_origin?: unknown }).entry_origin;
    return typeof v === "string" ? v : null;
  };
  const pharmacyPoints = points.filter((p) => originOf(p) === "pharmacy_machine").length;
  const diaryPoints = points.filter((p) => originOf(p) === "paper_diary").length;
  // S47a 4.6: the standard bands are drawn only for an adult who is not pregnant, and only while the trend_target_bands module is on (the bands are
  // PROPOSED until the CMO confirms them). Anything unknown means no band.
  const bandsEligible = useTrendBandsEligible(patientId).data === true;
  const glucoseBand = bandsEligible ? glucoseTrendBand(glucoseUnit) : null;
  const weightBand = bandsEligible ? weightTrendBand(heightStatus.data?.heightCm) : null;
  const noHeightOnFile =
    mode === "bmi" && !heightStatus.isLoading && heightStatus.data?.heightCm == null;
  const heightDiscrepancy = mode === "bmi" ? heightStatus.data?.discrepancy : null;

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
          <p className={notAvailable ? "text-sm text-amber-700" : "text-sm text-red-600 dark:text-red-300"}>
            {notAvailable
              ? "These readings are not available to you for this patient (you are not on their care team). This is not the same as no readings."
              : "Could not load the trend chart."}
          </p>
        )}
        {mode === "bmi" && !isLoading && !isError && noHeightOnFile && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Add your height in your{" "}
            <a href="/patient/profile" className="underline">
              profile settings
            </a>{" "}
            or your{" "}
            <a href="/patient/prevention#risk-assessment" className="underline">
              risk assessment
            </a>{" "}
            to see your BMI trend alongside your weight.
          </p>
        )}
        {mode === "bmi" && !isLoading && !isError && heightDiscrepancy && (
          <HeightDiscrepancyBanner
            patientId={patientId}
            profileHeightCm={heightDiscrepancy.profileHeightCm}
            questionnaireHeightCm={heightDiscrepancy.questionnaireHeightCm}
          />
        )}
        {!isLoading && !isError && !noHeightOnFile && points.length < 2 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Not enough readings yet.</p>
        )}
        {points.length >= 2 && (pharmacyPoints > 0 || diaryPoints > 0) && (
          <div data-testid="trend-origin-note" className="space-y-0.5 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {pharmacyPoints > 0 && <p>{t("pharm.trend_note", DEFAULT_LOCALE, { count: pharmacyPoints })}</p>}
            {diaryPoints > 0 && <p>{t("diary.trend_note", DEFAULT_LOCALE, { count: diaryPoints })}</p>}
          </div>
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
          <div className="space-y-2">
          <ChartContainer config={glucoseConfig(glucoseUnit)}>
            <LineChart data={points}>
              <CartesianGrid {...GRID_PROPS} />
              {/* S47a 4.6: the target band, shaded and also named in the caption below (colour is never the only signal). */}
              {glucoseBand ? (
                <ReferenceArea y1={glucoseBand.low} y2={glucoseBand.high} fill="var(--chart-glucose)" fillOpacity={0.12} ifOverflow="hidden" />
              ) : null}
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickCount={4}
                // Padding has to be in the plotted unit: +/-1 is a sensible
                // margin in mmol/L and an invisible one in mg/dL (18x larger).
                domain={
                  glucoseUnit === "mg_dl"
                    ? ["dataMin - 18", "dataMax + 18"]
                    : ["dataMin - 1", "dataMax + 1"]
                }
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                {...LINE_PROPS}
                dataKey="glucose_display"
                stroke="var(--color-glucose_display)"
                dot={makeEndpointDot(lastIndex, "var(--chart-glucose)", "above")}
              />
            </LineChart>
          </ChartContainer>
          {glucoseBand ? (
            <p data-testid="glucose-band-caption" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              {bandCaption("glucose", glucoseBand, GLUCOSE_UNIT_LABEL[glucoseUnit])}
            </p>
          ) : null}
          </div>
        )}
        {points.length >= 2 && mode === "weight" && (
          <div className="space-y-2">
          <ChartContainer config={WEIGHT_CONFIG}>
            <LineChart data={points}>
              <CartesianGrid {...GRID_PROPS} />
              {weightBand ? (
                <ReferenceArea y1={weightBand.low} y2={weightBand.high} fill="var(--chart-glucose)" fillOpacity={0.12} ifOverflow="hidden" />
              ) : null}
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
          {weightBand ? (
            <p data-testid="weight-band-caption" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              {bandCaption("weight", weightBand, "kg")}
            </p>
          ) : bandsEligible ? (
            <p data-testid="weight-band-missing" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Add your height in your profile settings to see the usual target range for your weight on this chart.
            </p>
          ) : null}
          </div>
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

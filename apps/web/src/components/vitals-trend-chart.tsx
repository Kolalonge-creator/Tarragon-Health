"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useVitalsTrend, useHba1cTrend, useBmiTrend, useLatestHeightCm } from "@/lib/queries/vitals";
import { getHba1cBracket } from "@/lib/rules/hba1c-bracket";
import { bmiCategory, type BmiCategory } from "@/lib/obesity/classify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

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

const BP_CONFIG: ChartConfig = {
  systolic: { label: "Systolic (mmHg)", color: "var(--color-chart-systolic)" },
  diastolic: { label: "Diastolic (mmHg)", color: "var(--color-chart-diastolic)" },
};

const GLUCOSE_CONFIG: ChartConfig = {
  glucose_mmol_l: { label: "Glucose (mmol/L)", color: "var(--color-chart-glucose)" },
};

const HBA1C_CONFIG: ChartConfig = {
  value: { label: "HbA1c (%)", color: "var(--color-chart-glucose)" },
};

const WEIGHT_CONFIG: ChartConfig = {
  weight_kg: { label: "Weight (kg)", color: "var(--color-chart-glucose)" },
};

const PULSE_CONFIG: ChartConfig = {
  pulse_bpm: { label: "Heart rate (bpm)", color: "var(--color-chart-systolic)" },
};

const BMI_CONFIG: ChartConfig = {
  bmi: { label: "BMI", color: "var(--color-chart-glucose)" },
};

function formatDate(taken_at: string): string {
  return new Date(taken_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load the trend chart.</p>
        )}
        {mode === "bmi" && !isLoading && !isError && noHeightOnFile && (
          <p className="text-sm text-charcoal-ink/60">
            Add your height in your{" "}
            <a href="/patient/prevention#risk-assessment" className="underline">
              risk assessment
            </a>{" "}
            to see your BMI trend alongside your weight.
          </p>
        )}
        {!isLoading && !isError && !noHeightOnFile && points.length < 2 && (
          <p className="text-sm text-charcoal-ink/60">Not enough readings yet.</p>
        )}
        {points.length >= 2 && mode === "blood_pressure" && (
          <ChartContainer config={BP_CONFIG}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} domain={["dataMin - 10", "dataMax + 10"]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="systolic" stroke="var(--color-systolic)" dot={false} />
              <Line type="monotone" dataKey="diastolic" stroke="var(--color-diastolic)" dot={false} />
            </LineChart>
          </ChartContainer>
        )}
        {points.length >= 2 && mode === "glucose" && (
          <ChartContainer config={GLUCOSE_CONFIG}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} domain={["dataMin - 1", "dataMax + 1"]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="glucose_mmol_l"
                stroke="var(--color-glucose_mmol_l)"
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
        {points.length >= 2 && mode === "weight" && (
          <ChartContainer config={WEIGHT_CONFIG}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} domain={["dataMin - 2", "dataMax + 2"]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="weight_kg" stroke="var(--color-weight_kg)" dot={false} />
            </LineChart>
          </ChartContainer>
        )}
        {points.length >= 2 && mode === "pulse" && (
          <ChartContainer config={PULSE_CONFIG}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} domain={["dataMin - 10", "dataMax + 10"]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="pulse_bpm" stroke="var(--color-pulse_bpm)" dot={false} />
            </LineChart>
          </ChartContainer>
        )}
        {points.length >= 2 && mode === "hba1c" && (
          <div className="space-y-2">
            <ChartContainer config={HBA1C_CONFIG}>
              <LineChart data={points}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} domain={["dataMin - 0.5", "dataMax + 0.5"]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="value" stroke="var(--color-value)" dot={false} />
              </LineChart>
            </ChartContainer>
            {(() => {
              const latest = points[points.length - 1] as { value: number };
              const bracket = getHba1cBracket(latest.value);
              return (
                <p className="text-xs text-charcoal-ink/60">
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
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} domain={["dataMin - 1", "dataMax + 1"]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="bmi" stroke="var(--color-bmi)" dot={false} />
              </LineChart>
            </ChartContainer>
            {(() => {
              const latest = points[points.length - 1] as { bmi: number };
              return (
                <p className="text-xs text-charcoal-ink/60">
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

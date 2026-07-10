"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useVitalsTrend } from "@/lib/queries/vitals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const BP_CONFIG: ChartConfig = {
  systolic: { label: "Systolic (mmHg)", color: "var(--color-chart-systolic)" },
  diastolic: { label: "Diastolic (mmHg)", color: "var(--color-chart-diastolic)" },
};

const GLUCOSE_CONFIG: ChartConfig = {
  glucose_mmol_l: { label: "Glucose (mmol/L)", color: "var(--color-chart-glucose)" },
};

function formatDate(taken_at: string): string {
  return new Date(taken_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function VitalsTrendChart({ patientId }: { patientId: string }) {
  const [mode, setMode] = useState<"blood_pressure" | "glucose">("blood_pressure");
  const { data, isLoading, isError } = useVitalsTrend(patientId, mode);
  const points = (data ?? []).map((reading) => ({ ...reading, date: formatDate(reading.taken_at) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trends</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
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
        </div>

        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load the trend chart.</p>
        )}
        {!isLoading && !isError && points.length < 2 && (
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
      </CardContent>
    </Card>
  );
}

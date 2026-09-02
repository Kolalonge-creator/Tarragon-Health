"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useGrowthMeasurements, useLogGrowthMeasurement } from "@/lib/queries/growth";
import { zScoreToPercentile, formatPercentile } from "@/lib/growth/zscore-to-percentile";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const WEIGHT_CONFIG: ChartConfig = { weight_kg: { label: "Weight (kg)", color: "var(--color-chart-glucose)" } };
const HEIGHT_CONFIG: ChartConfig = { height_cm: { label: "Height (cm)", color: "var(--color-chart-systolic)" } };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

/**
 * Growth monitoring (§48.3/§48.4): logs raw weight/height/head-circumference
 * measurements and charts them over time. Percentile/z-score panels only
 * appear once the database has a matching WHO/CDC reference row — until real
 * reference data is loaded (see 20260829121652_pediatric_growth_monitoring.sql's
 * header), they read "Reference data pending", never a fabricated percentile.
 * Renders nothing for a subject 19 or older — this is a paediatric chart.
 */
export function GrowthTrackingCard({
  patientId,
  organisationId,
  ageYears,
}: {
  patientId: string;
  organisationId: string | null;
  ageYears: number | null;
}) {
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [headCircumferenceCm, setHeadCircumferenceCm] = useState("");
  const { data: measurements, isLoading, isError } = useGrowthMeasurements(patientId);
  const logMeasurement = useLogGrowthMeasurement();

  if (ageYears !== null && ageYears >= 19) return null;

  const weightPoints = (measurements ?? [])
    .filter((m) => m.weight_kg !== null)
    .map((m) => ({ date: formatDate(m.measured_at), weight_kg: m.weight_kg }));
  const heightPoints = (measurements ?? [])
    .filter((m) => m.height_cm !== null)
    .map((m) => ({ date: formatDate(m.measured_at), height_cm: m.height_cm }));

  const latest = measurements && measurements.length > 0 ? measurements[measurements.length - 1] : null;
  const latestZ = latest?.weight_for_age_z ?? latest?.height_for_age_z ?? null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    await logMeasurement.mutateAsync({
      patientId,
      organisationId,
      heightCm: heightCm ? Number(heightCm) : null,
      weightKg: weightKg ? Number(weightKg) : null,
      headCircumferenceCm: headCircumferenceCm ? Number(headCircumferenceCm) : null,
    });
    setHeightCm("");
    setWeightKg("");
    setHeadCircumferenceCm("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Growth</CardTitle>
        <CardDescription>
          Weight, height, and head circumference over time — flagged for clinical review on a
          significant change, never diagnosed from the chart alone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load growth measurements.</p>}

        {latest && (
          <p className="text-xs text-charcoal-ink/60">
            Latest:{" "}
            {latestZ !== null
              ? formatPercentile(zScoreToPercentile(latestZ))
              : "Reference data pending — showing raw measurements only"}
          </p>
        )}

        {weightPoints.length >= 2 && (
          <ChartContainer config={WEIGHT_CONFIG}>
            <LineChart data={weightPoints}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} domain={["dataMin - 1", "dataMax + 1"]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="weight_kg" stroke="var(--color-weight_kg)" dot />
            </LineChart>
          </ChartContainer>
        )}

        {heightPoints.length >= 2 && (
          <ChartContainer config={HEIGHT_CONFIG}>
            <LineChart data={heightPoints}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} domain={["dataMin - 2", "dataMax + 2"]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="height_cm" stroke="var(--color-height_cm)" dot />
            </LineChart>
          </ChartContainer>
        )}

        {!isLoading && (measurements?.length ?? 0) < 2 && (
          <p className="text-sm text-charcoal-ink/60">Log at least two measurements to see a trend.</p>
        )}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="height_cm">Height / length (cm)</Label>
            <Input
              id="height_cm"
              type="number"
              step="0.1"
              min="0"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weight_kg">Weight (kg)</Label>
            <Input
              id="weight_kg"
              type="number"
              step="0.01"
              min="0"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="head_circumference_cm">Head circumference (cm)</Label>
            <Input
              id="head_circumference_cm"
              type="number"
              step="0.1"
              min="0"
              value={headCircumferenceCm}
              onChange={(e) => setHeadCircumferenceCm(e.target.value)}
            />
          </div>
          <div className="sm:col-span-3">
            {logMeasurement.isError && (
              <p className="mb-2 text-sm text-red-600">Could not save this measurement.</p>
            )}
            <Button
              type="submit"
              disabled={
                logMeasurement.isPending || (!heightCm && !weightKg && !headCircumferenceCm) || !organisationId
              }
            >
              {logMeasurement.isPending ? "Saving…" : "Log measurement"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

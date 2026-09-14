"use client";

import type { ReactNode } from "react";
import { useReproductiveHealthAnalytics } from "@/lib/queries/reproductive-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function NotReportable({ floor }: { floor: number }) {
  return (
    <span className="text-charcoal-ink/40">
      Fewer than {floor} people — withheld
    </span>
  );
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-charcoal-ink/5 py-2 text-sm">
      <span className="text-charcoal-ink/70">{label}</span>
      <span className="font-medium text-charcoal-ink">{value}</span>
    </div>
  );
}

function FrequencyList({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p className="text-sm text-charcoal-ink/40">No values clear the reporting floor yet.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {entries.map(([label, count]) => (
        <li key={label} className="flex items-baseline justify-between">
          <span className="capitalize text-charcoal-ink/70">{label.replace(/_/g, " ")}</span>
          <span className="font-medium text-charcoal-ink">{count}</span>
        </li>
      ))}
    </ul>
  );
}

export function AnalyticsManager() {
  const { data, isLoading, isError } = useReproductiveHealthAnalytics();

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError) return <p className="text-sm text-red-600">Could not load analytics.</p>;
  if (!data) return null;

  const floor = data.min_cohort_size;
  const profiles = data.reproductive_health_profiles;
  const cycles = data.menstrual_cycle_tracking;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Reproductive health profiles</CardTitle>
          <CardDescription>Adoption, by life stage.</CardDescription>
        </CardHeader>
        <CardContent>
          <StatRow
            label="Total profiles"
            value={profiles.reportable ? profiles.total : <NotReportable floor={floor} />}
          />
          {profiles.reportable && Object.keys(profiles.by_life_stage).length > 0 && (
            <div className="mt-3">
              <FrequencyList counts={profiles.by_life_stage as Record<string, number>} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Menstrual cycle tracking</CardTitle>
          <CardDescription>Adoption and logging volume.</CardDescription>
        </CardHeader>
        <CardContent>
          <StatRow
            label="Patients tracking"
            value={cycles.reportable ? cycles.patients_tracking : <NotReportable floor={floor} />}
          />
          <StatRow
            label="Total cycles logged"
            value={cycles.reportable ? cycles.total_cycles_logged : <NotReportable floor={floor} />}
          />
          <StatRow
            label="Avg. cycle length"
            value={
              cycles.reportable && cycles.avg_cycle_length_days !== null
                ? `${cycles.avg_cycle_length_days} days`
                : <NotReportable floor={floor} />
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Symptom frequency</CardTitle>
          <CardDescription>From daily logs, values below {floor} people omitted.</CardDescription>
        </CardHeader>
        <CardContent>
          <FrequencyList counts={data.symptom_frequency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mood frequency</CardTitle>
          <CardDescription>From daily logs, values below {floor} people omitted.</CardDescription>
        </CardHeader>
        <CardContent>
          <FrequencyList counts={data.mood_frequency} />
        </CardContent>
      </Card>
    </div>
  );
}

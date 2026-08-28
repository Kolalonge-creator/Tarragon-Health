"use client";

import { useMedications } from "@/lib/queries/medications";
import { useWeeklyDoseLogs } from "@/lib/queries/adherence-summary";
import { buildWeeklyAdherenceSummary } from "@/lib/medication-schedule/weekly-adherence";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** 13.7's patient adherence dashboard: "Medication A — 6/7 doses… Overall
 * adherence 93%" for the trailing 7 days. Only renders once there's at least
 * one scheduled dose to measure — a patient with no schedule_times set sees
 * nothing here rather than a confusing "0%". */
export function WeeklyAdherenceSummary({ patientId }: { patientId: string }) {
  const { data: medications, isLoading: medsLoading } = useMedications(patientId);
  const { data: logs, isLoading: logsLoading } = useWeeklyDoseLogs(patientId);

  if (medsLoading || logsLoading) return null;

  const summary = buildWeeklyAdherenceSummary(medications ?? [], logs ?? []);
  const measured = summary.medications.filter((m) => m.expectedCount > 0);
  if (measured.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>This week</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-1.5">
          {measured.map((m) => (
            <li key={m.medicationId} className="flex items-center justify-between text-sm">
              <span className="text-charcoal-ink">{m.drugName}</span>
              <span className="text-charcoal-ink/60">
                {m.takenCount}/{m.expectedCount} doses
              </span>
            </li>
          ))}
        </ul>
        {summary.overallPercentage !== null && (
          <div className="flex items-center justify-between border-t border-charcoal-ink/10 pt-2 text-sm font-medium">
            <span className="text-charcoal-ink">Overall adherence</span>
            <span className="text-brand-green">{summary.overallPercentage}%</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

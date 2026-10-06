"use client";

import { useWeeklySummary } from "@/lib/queries/weekly-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatGlucose, type GlucoseDisplayUnit } from "@tarragon/shared";
import { GLUCOSE_CONTEXT_LABEL } from "@/lib/visit-report/summarise";
import type { WeeklySummary } from "@/lib/visit-report/weekly";

function change(n: number): string {
  if (n === 0) return "the same as the week before";
  return `${Math.abs(n)} ${n > 0 ? "higher" : "lower"} than the week before`;
}

/**
 * "Your week": what the patient logged over the last 7 days. It describes
 * and compares numbers and never says a number is good or bad, which is the
 * care team's call. A quiet week gets a calm line, never a guilt message.
 */
export function WeeklySummaryBody({
  data,
  glucoseUnit,
}: {
  data: WeeklySummary;
  glucoseUnit: GlucoseDisplayUnit;
}) {
  const { thisWeek } = data;
  const nothing =
    !thisWeek.bp && thisWeek.glucoseByContext.length === 0 && !thisWeek.pulse && !thisWeek.weight;

  if (nothing) {
    return (
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        No readings in the last 7 days. Whenever you log one, your week will show up here.
      </p>
    );
  }

  return (
    <div className="space-y-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
      <p className="text-base font-medium text-charcoal-ink dark:text-night-ink">
        You logged readings on {data.loggedDays} of the last 7 days.
      </p>
      {thisWeek.bp && (
        <p>
          Blood pressure: average {thisWeek.bp.averageSystolic}/{thisWeek.bp.averageDiastolic} from{" "}
          {thisWeek.bp.count} reading{thisWeek.bp.count === 1 ? "" : "s"}.
          {data.bpAverageChange && (
            <>
              {" "}
              Top number {change(data.bpAverageChange.systolic)}, bottom number{" "}
              {change(data.bpAverageChange.diastolic)}.
            </>
          )}
        </p>
      )}
      {thisWeek.glucoseByContext.map((g) => (
        <p key={g.context}>
          Blood sugar, {(GLUCOSE_CONTEXT_LABEL[g.context] ?? g.context).toLowerCase()}: average{" "}
          {formatGlucose(g.average, glucoseUnit)} from {g.count} reading{g.count === 1 ? "" : "s"}.
        </p>
      ))}
      {thisWeek.weight && thisWeek.weight.count > 1 && (
        <p>
          Weight: {thisWeek.weight.latest.kg} kg, {thisWeek.weight.changeKg > 0 ? "up" : "down"}{" "}
          {Math.abs(thisWeek.weight.changeKg)} kg this week.
        </p>
      )}
      {data.partial && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          You have a lot of readings, so this shows your most recent ones and skips the comparison.
        </p>
      )}
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        This describes your numbers. Your care team can tell you what they mean for you.
      </p>
    </div>
  );
}

export function WeeklySummaryCard({
  patientId,
  glucoseUnit,
}: {
  patientId: string;
  glucoseUnit: GlucoseDisplayUnit;
}) {
  const { data, isLoading, isError } = useWeeklySummary(patientId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your week</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">Could not load your week.</p>
        )}
        {data && !isLoading && <WeeklySummaryBody data={data} glucoseUnit={glucoseUnit} />}
      </CardContent>
    </Card>
  );
}

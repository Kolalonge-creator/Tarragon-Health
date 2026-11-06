import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadErrorCard } from "@/components/ui/load-error-card";
import { DoseBars } from "@/components/charts/dose-bars";
import { createClient } from "@/lib/supabase/server";
import { loadDoseHistory } from "@/lib/medicines/dose-history-data";
import type { DoseWindow } from "@/lib/medicines/dose-history";

function Figure({ window, label }: { window: DoseWindow; label: string }) {
  return (
    <div>
      {window.percent !== null ? (
        <p className="font-heading text-4xl font-semibold leading-none tracking-tight text-charcoal-ink sm:text-5xl dark:text-night-ink">
          {window.percent}%
        </p>
      ) : (
        <p className="py-1 text-base text-charcoal-ink/55 dark:text-night-ink/60">Too few doses to show a percentage</p>
      )}
      <p className="mt-1 text-sm font-medium text-charcoal-ink/75 dark:text-night-ink/75">{label}</p>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        {window.due === 0 ? "Nothing was due" : `${window.taken} of ${window.due} marked taken`}
      </p>
    </div>
  );
}

/**
 * "Doses taken" on Medications (founder, 2026-11-06, chosen in a prompt): the last 7 and last 30 days as big percentages and
 * a 4-week chart of each day. Same formula as the printed adherence report (completed days only, so today's open doses are
 * never counted as missed). It shows what the patient marked; it is not a grade, so there is no colour band or target line.
 * Hidden when nothing has been scheduled in the last month; a failed read says so rather than drawing an empty month.
 */
export async function DosesTakenCard({ patientId }: { patientId: string }) {
  const loaded = await loadDoseHistory(await createClient(), patientId);
  if (!loaded.ok) return <LoadErrorCard title="Doses taken" what="your dose history" />;
  const { last7, last30, days } = loaded.history;
  if (last30.due === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Doses taken</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Figure window={last7} label="Last 7 days" />
          <Figure window={last30} label="Last 30 days" />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60">Each day, last 4 weeks</p>
          <DoseBars days={days} />
        </div>
        <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/60">
          Counts the doses you marked as taken, up to yesterday. Today is in Today&apos;s doses.
        </p>
      </CardContent>
    </Card>
  );
}

"use client";

import { useHbpmSummary } from "@/lib/queries/bp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * 7-day home BP average (HBPM, TH-CP-HTN-001 §5.3) shown against the patient's
 * individual home target (§12.2). Non-diagnostic: whether BP is "controlled" is
 * a clinician judgement (§20), never asserted here — this shows the number and
 * the target, and leaves the verdict to the care team.
 */
export function HbpmSummaryCard({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useHbpmSummary(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.bp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your 7-day home BP average
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your average.</p>
        )}
        {data && !isLoading && (
          <div className="space-y-2">
            {data.average ? (
              <>
                <p className="text-2xl font-semibold text-charcoal-ink">
                  {data.average.systolic}/{data.average.diastolic}{" "}
                  <span className="text-sm font-normal text-charcoal-ink/60">mmHg</span>
                </p>
                <p className="text-xs text-charcoal-ink/60">
                  Average of {data.average.n_readings} readings over{" "}
                  {data.average.n_days} day{data.average.n_days === 1 ? "" : "s"} (the
                  first day is set aside as it usually reads higher).
                </p>
              </>
            ) : (
              <p className="text-sm text-charcoal-ink/70">
                Log your home readings twice each morning and evening for 7 days and
                your average will appear here.
              </p>
            )}
            <p className="text-sm text-charcoal-ink/80">
              Your home target:{" "}
              <span className="font-medium">
                below {data.target.systolic}/{data.target.diastolic} mmHg
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

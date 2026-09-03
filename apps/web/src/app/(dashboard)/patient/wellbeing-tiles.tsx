"use client";

import { useState } from "react";
import {
  useLatestWellbeingCheckin,
  useWellbeingCheckinPreference,
  useNextMedicationReview,
  useNextMentalHealthScreeningDue,
} from "@/lib/queries/wellbeing";
import { bandHigherIsBetter, bandLowerIsBetter, wellbeingBandLabel } from "@/lib/wellbeing/banding";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function Tile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <p className="text-xs uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{label}</p>
      {value ? (
        <p className="mt-1 text-sm font-medium text-charcoal-ink dark:text-night-ink">{value}</p>
      ) : (
        <p className="mt-1 text-sm text-charcoal-ink/50 dark:text-night-ink/55">No check-in yet</p>
      )}
    </div>
  );
}

/**
 * "YOUR WELLBEING" dashboard tiles (Module 46 §46.2): Mood / Stress / Sleep
 * from the latest self check-in, whether a new check-in is due (the
 * patient's own reminder_frequency_days preference, §46.13), and the nearest
 * upcoming clinical review, if one is already scheduled. This is engagement
 * telemetry, not a clinical instrument — see MentalHealthSummary for the
 * PHQ-9/GAD-7/AUDIT-C/EPDS scores.
 */
export function WellbeingTiles({ patientId }: { patientId: string }) {
  const { data: latest, isLoading } = useLatestWellbeingCheckin(patientId);
  const { data: preference } = useWellbeingCheckinPreference(patientId);
  const { data: nextMedicationReview } = useNextMedicationReview(patientId);
  const { data: nextScreeningDue } = useNextMentalHealthScreeningDue(patientId);
  // Lazy initializer runs once on mount, not on every render — the accepted
  // pattern for reading the clock from a component body without tripping the
  // "impure function during render" rule. A stale "now" across a long-open
  // tab is fine here; a page load/refetch always gets a fresh one.
  const [now] = useState(() => Date.now());

  if (isLoading) return null;

  const frequencyDays = preference?.reminder_frequency_days ?? 7;
  const daysSinceLastCheckin = latest
    ? Math.floor((now - new Date(latest.checked_in_at).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isDue = daysSinceLastCheckin === null || daysSinceLastCheckin >= frequencyDays;

  // "Next review" surfaces whichever clinical touchpoint is soonest — a
  // pending medication review or the next due mental-health screen — rather
  // than picking one source arbitrarily.
  const candidateDueDates = [nextMedicationReview?.due_date, nextScreeningDue?.due_date].filter(
    (d): d is string => Boolean(d)
  );
  const nextReviewDate =
    candidateDueDates.length > 0
      ? candidateDueDates.reduce((earliest, d) => (d < earliest ? d : earliest))
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your wellbeing</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile
            label="Mood"
            value={latest ? wellbeingBandLabel(bandHigherIsBetter(latest.mood_score)) : null}
          />
          <Tile
            label="Stress"
            value={latest ? wellbeingBandLabel(bandLowerIsBetter(latest.stress_score)) : null}
          />
          <Tile
            label="Sleep"
            value={latest ? wellbeingBandLabel(bandHigherIsBetter(latest.sleep_quality)) : null}
          />
          <div className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
            <p className="text-xs uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">Wellbeing check</p>
            <p className="mt-1 text-sm font-medium">
              {isDue ? <Badge variant="amber">Due</Badge> : <span className="text-brand-green dark:text-brand-green-bright">Up to date</span>}
            </p>
          </div>
          {nextReviewDate && (
            <div className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
              <p className="text-xs uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">Next review</p>
              <p className="mt-1 text-sm font-medium text-charcoal-ink dark:text-night-ink">
                {new Date(nextReviewDate).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos",
                  day: "numeric",
                  month: "long",
                })}
              </p>
            </div>
          )}
        </div>
        {!latest && (
          <p className="mt-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Log your first check-in below to see your mood, stress and sleep at a glance.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

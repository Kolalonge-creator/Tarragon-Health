"use client";

import { usePatientHealthResetProgress } from "@/lib/queries/health-reset";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

function Milestone({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
          done ? "bg-brand-green text-white" : "border border-charcoal-ink/25 dark:border-night-ink/30 text-transparent"
        }`}
      >
        ✓
      </span>
      <span className={done ? "text-charcoal-ink dark:text-night-ink" : "text-charcoal-ink/60 dark:text-night-ink/60"}>{label}</span>
    </li>
  );
}

/**
 * "The Tarragon 90-Day Health Reset" — the pricing page's free, tracked
 * onboarding journey, made real by lib/queries/health-reset.ts. The milestone
 * "claim a 30-day Complete Care trial" CTA that used to complete this card was
 * removed with the 2026-09-02 retirement of subscription plans: Complete Care
 * no longer exists and the app itself is free, so there is nothing to trial.
 */
export function HealthResetCard({ patientId }: { patientId: string }) {
  const { data: progress, isLoading, isError } = usePatientHealthResetProgress(patientId);
  const Icon = SEMANTIC_ICON.preventive;

  if (isLoading || isError || !progress) return null;

  const isComplete = !!progress.completed_at;
  const dayLabel = Math.min(progress.day_number, 90);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-brand-green dark:text-brand-green-bright" aria-hidden />
          {isComplete ? "90-Day Health Reset: complete" : `90-Day Health Reset: day ${dayLabel} of 90`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1.5">
          <Milestone done={progress.baseline_done} label="Baseline set: a first reading and your health profile" />
          <Milestone done={progress.programme_set_done} label="Your care team sets up your plan or screening calendar" />
          <Milestone done={progress.consistency_done} label="Building the habit: regular logging or learning" />
        </ul>

        {isComplete ? (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            You&apos;ve completed your 90-Day Health Reset: the habit is yours now. Keep logging,
            and everything here stays free for as long as you use Tarragon.
          </p>
        ) : (
          <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
            Free, for as long as you use Tarragon, with no expiry date.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

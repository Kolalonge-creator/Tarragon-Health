"use client";

import { usePatientHealthResetProgress, useClaimHealthResetTrial } from "@/lib/queries/health-reset";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

function Milestone({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
          done ? "bg-brand-green text-white" : "border border-charcoal-ink/25 text-transparent"
        }`}
      >
        ✓
      </span>
      <span className={done ? "text-charcoal-ink" : "text-charcoal-ink/60"}>{label}</span>
    </li>
  );
}

/**
 * The pricing page has long promised "The Tarragon 90-Day Health Reset" as
 * INCLUDED on every plan, plus a milestone free trial on completion. This
 * card is what makes both real — see lib/queries/health-reset.ts.
 */
export function HealthResetCard({ patientId }: { patientId: string }) {
  const { data: progress, isLoading, isError } = usePatientHealthResetProgress(patientId);
  const claim = useClaimHealthResetTrial(patientId);
  const Icon = SEMANTIC_ICON.preventive;

  if (isLoading || isError || !progress) return null;

  const isComplete = !!progress.completed_at;
  const dayLabel = Math.min(progress.day_number, 90);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-brand-green" aria-hidden />
          {isComplete ? "90-Day Health Reset: complete" : `90-Day Health Reset: day ${dayLabel} of 90`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1.5">
          <Milestone done={progress.baseline_done} label="Baseline set: a first reading and your health profile" />
          <Milestone done={progress.programme_set_done} label="Your care team sets up your plan or screening calendar" />
          <Milestone done={progress.consistency_done} label="Building the habit: regular logging or learning" />
        </ul>

        {isComplete && !progress.trial_claimed_at && (
          <div className="space-y-2 rounded-md bg-brand-green/[0.06] p-3">
            <p className="text-sm text-charcoal-ink">
              You&apos;ve completed your 90-Day Health Reset. As promised, you can claim 30 days of
              Complete Care at no charge, no card required, so a doctor reviews your numbers
              for a month before you decide.
            </p>
            <Button size="sm" disabled={claim.isPending} onClick={() => claim.mutate()}>
              {claim.isPending ? "Claiming…" : "Claim my free trial"}
            </Button>
            {claim.isError && (
              <p className="text-xs text-red-600">
                {(claim.error as Error).message || "Could not claim the trial. Try again."}
              </p>
            )}
          </div>
        )}

        {progress.trial_claimed_at && (
          <p className="text-sm text-charcoal-ink/70">
            Your free trial is active: enjoy the full Complete Care experience. It quietly
            returns you to Tarragon Free at the end unless you choose to continue.
          </p>
        )}

        {!isComplete && (
          <p className="text-xs text-charcoal-ink/50">
            Free on every plan, including Tarragon Free, for as long as you use Tarragon.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

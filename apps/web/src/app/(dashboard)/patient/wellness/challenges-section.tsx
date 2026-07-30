"use client";

import {
  useWellnessChallengesCatalogue,
  useMyChallengeEnrolments,
  useEnrolInWellnessChallenge,
  useWellnessChallengeProgress,
  type ChallengeEnrolment,
} from "@/lib/queries/wellness";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

function ProgressBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-charcoal-ink/10">
      <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ActiveEnrolmentRow({ enrolment }: { enrolment: ChallengeEnrolment }) {
  const { data: progress } = useWellnessChallengeProgress(enrolment.id);
  const challenge = enrolment.wellness_challenges;
  if (!challenge) return null;

  return (
    <li className="rounded-lg border border-charcoal-ink/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink">{challenge.title}</p>
        <Badge
          variant={
            enrolment.status === "completed" ? "green" : enrolment.status === "expired" ? "grey" : "blue"
          }
        >
          {enrolment.status}
        </Badge>
      </div>
      {enrolment.status === "active" && progress && (
        <div className="mt-2 space-y-1">
          <ProgressBar value={progress.progress} target={progress.target} />
          <p className="text-xs text-charcoal-ink/60">
            {progress.progress} of {progress.target}
          </p>
        </div>
      )}
    </li>
  );
}

export function ChallengesSection({ patientId }: { patientId: string }) {
  const { data: catalogue, isLoading } = useWellnessChallengesCatalogue();
  const { data: enrolments } = useMyChallengeEnrolments(patientId);
  const enrol = useEnrolInWellnessChallenge(patientId);

  const activeChallengeIds = new Set(
    (enrolments ?? []).filter((e) => e.status === "active").map((e) => e.challenge_id)
  );
  const available = (catalogue ?? []).filter((c) => !activeChallengeIds.has(c.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.challenge className="h-5 w-5 text-sprout-gold" strokeWidth={2} />
          Challenges
        </CardTitle>
        <CardDescription>Time-boxed goals that pay a points bonus when you finish.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}

        {enrolments && enrolments.length > 0 && (
          <ul className="space-y-2">
            {enrolments
              .filter((e) => e.status !== "expired")
              .map((e) => (
                <ActiveEnrolmentRow key={e.id} enrolment={e} />
              ))}
          </ul>
        )}

        {available.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Available
            </p>
            <ul className="space-y-2">
              {available.map((challenge) => (
                <li
                  key={challenge.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-ink/10 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">{challenge.title}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {challenge.description} · {challenge.points_reward} pts
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={enrol.isPending}
                    onClick={() => enrol.mutate(challenge.id)}
                  >
                    Join
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {enrol.isError && (
          <p className="text-sm text-red-600">
            {enrol.error instanceof Error ? enrol.error.message : "Could not join that challenge."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

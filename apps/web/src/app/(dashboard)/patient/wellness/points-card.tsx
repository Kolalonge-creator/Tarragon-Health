"use client";

import { useWellnessPointsBalance, useWellnessPointsLedger } from "@/lib/queries/wellness";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

const REASON_LABEL: Record<string, string> = {
  vitals_logged: "Logged a vitals reading",
  meal_logged: "Logged a meal",
  adherence_checkin_completed: "Answered a medication check-in",
  education_lesson_completed: "Completed a lesson",
  lpe_task_completed: "Completed a lifestyle task",
  lpe_goal_achieved: "Achieved a lifestyle goal",
  challenge_completed: "Completed a challenge",
  wellness_class_attended: "Attended a class",
  redeemed_to_voucher: "Redeemed (earlier rewards)",
};

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

export function WellnessPointsCard({ patientId }: { patientId: string }) {
  const { data: balance, isLoading } = useWellnessPointsBalance(patientId);
  const { data: ledger } = useWellnessPointsLedger(patientId, 8);

  const currentBalance = balance?.balance ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.points className="h-5 w-5 text-sprout-gold" strokeWidth={2} aria-hidden />
          Wellness points
        </CardTitle>
        <CardDescription>
          Earn points for logging vitals, meals, and check-ins, finishing lessons, and hitting
          challenges. Points are a way to see your progress; they are not money.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {!isLoading && (
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-3xl font-bold text-charcoal-ink dark:text-night-ink">
              {currentBalance.toLocaleString()}
            </span>
            <span className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              points{balance?.lifetime_earned ? ` · ${balance.lifetime_earned.toLocaleString()} earned all-time` : ""}
            </span>
          </div>
        )}

        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Points cannot be redeemed yet. Your points are safe and keep building.
        </p>

        {ledger && ledger.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
              Recent activity
            </p>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 text-sm">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between py-1.5">
                  <span className="text-charcoal-ink/80 dark:text-night-ink/80">{reasonLabel(entry.reason)}</span>
                  <span
                    className={entry.points > 0 ? "font-medium text-brand-green dark:text-brand-green-bright" : "font-medium text-charcoal-ink/60 dark:text-night-ink/60"}
                  >
                    {entry.points > 0 ? "+" : ""}
                    {entry.points}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

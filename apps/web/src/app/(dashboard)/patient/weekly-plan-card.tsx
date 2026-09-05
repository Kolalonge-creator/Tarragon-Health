"use client";

import { useWeeklyPlan, useMarkGoalDone } from "@/lib/queries/lpe";
import { LPE_MODULE_LABEL } from "@/lib/lpe/module-labels";
import { sortGoalsByPriority, getPriorityWeeklyGoal, type WeeklyPlanGoal } from "@/lib/lpe/weekly-plan";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { EmptyHint } from "@/components/ui/empty-hint";
import { RoutineProfilePrompt } from "@/app/(dashboard)/patient/routine-profile-prompt";

/** A 14-day dot trend, oldest-first (today last) — unlike a bare streak
 * count, a missed day stays visible as a hollow dot rather than disappearing,
 * so the row reads as an honest trend instead of only ever showing progress. */
function TrendDots({ goal }: { goal: WeeklyPlanGoal }) {
  const doneCount = goal.last14Days.filter((d) => d === "done").length;
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-[3px]" aria-label={`${doneCount} of the last 14 days done`}>
        {goal.last14Days.map((outcome, i) => (
          <span
            key={i}
            className={
              outcome === "done"
                ? "h-1.5 w-1.5 rounded-full bg-brand-green"
                : "h-1.5 w-1.5 rounded-full border border-charcoal-ink/20 dark:border-night-ink/25"
            }
            aria-hidden
          />
        ))}
      </div>
      <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        {doneCount}/{goal.last14Days.length} days
        {goal.streak.currentStreak > 0 && ` · ${goal.streak.currentStreak}-day streak`}
      </span>
    </div>
  );
}

function GoalRow({ goal, patientId }: { goal: WeeklyPlanGoal; patientId: string }) {
  const markDone = useMarkGoalDone(patientId);
  const done = goal.cadence === "weekly" ? goal.doneThisWeek : goal.doneToday;

  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="grey">{LPE_MODULE_LABEL[goal.module]}</Badge>
          {goal.cadence === "weekly" && (
            <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">this week</span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-charcoal-ink dark:text-night-ink">{goal.title}</p>
        {goal.measurementType && (
          <div className="mt-1">
            <TrendDots goal={goal} />
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant={done ? "outline" : "default"}
        disabled={done || !goal.measurementType || markDone.isPending}
        onClick={() =>
          markDone.mutate({
            organisationId: goal.organisationId,
            enrollmentId: goal.enrollmentId,
            measurementType: goal.measurementType,
          })
        }
      >
        {done ? "Done" : "Mark done"}
      </Button>
    </li>
  );
}

export function WeeklyPlanCard({
  patientId,
  emptyHint,
}: {
  patientId: string;
  emptyHint?: string;
}) {
  const { data: plan, isLoading } = useWeeklyPlan(patientId);

  // No active lifestyle enrolment: nothing to show, same "render nothing"
  // pattern as CareScheduleCard when there's nothing due — this card is
  // additive, never a forced universal habit tracker for every patient.
  // A caller that has already put a heading above this one (Health summary)
  // passes `emptyHint` so that heading is answered instead of left bare.
  if (isLoading) return null;
  if (!plan || plan.goals.length === 0) return emptyHint ? <EmptyHint>{emptyHint}</EmptyHint> : null;

  // Adaptive, not a flat list: the goal most needing attention (a raised
  // miss streak, then any recent miss) leads, matching the "start here"
  // shape HealthScoreCard uses for getPriorityHealthScoreTip.
  const orderedGoals = sortGoalsByPriority(plan.goals);
  const priorityGoal = getPriorityWeeklyGoal(plan.goals);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.carePlan className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Your weekly plan
        </CardTitle>
        {plan.totalToday > 0 && (
          <CardDescription>
            {plan.doneToday} of {plan.totalToday} done today
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {priorityGoal && (
          <div className="mb-3 space-y-1">
            <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">Focus on this today</p>
            <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
              {LPE_MODULE_LABEL[priorityGoal.module]} · {priorityGoal.title}
              {priorityGoal.streak.shouldRaiseWorklistItem &&
                ": a few days missed in a row, worth a fresh start today."}
            </p>
          </div>
        )}
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {orderedGoals.map((goal) => (
            <GoalRow key={goal.id} goal={goal} patientId={patientId} />
          ))}
        </ul>
        <RoutineProfilePrompt patientId={patientId} />
      </CardContent>
    </Card>
  );
}

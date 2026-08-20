"use client";

import { useActionState } from "react";
import { completeReview, type ReviewState } from "./actions";
import type { WeeklyPlanGoal } from "@/lib/lpe/weekly-plan";
import { LPE_MODULE_LABEL } from "@/lib/lpe/module-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface PendingReview {
  id: string;
  patientName: string;
  condition: string;
  dueDate: string;
  /** This enrolment's active weekly-plan goals — read-only here, a
   * clinician reviews adherence, never logs it on a patient's behalf. */
  goals: WeeklyPlanGoal[];
}

function goalDone(goal: WeeklyPlanGoal): boolean {
  return goal.cadence === "weekly" ? goal.doneThisWeek : goal.doneToday;
}

/**
 * A compact, read-only adherence summary for the doctor completing this
 * review — the same `lpe_goal_instances`/`lpe_measurements` data the patient
 * sees on their own dashboard (`weekly-plan-card.tsx`), just without the
 * "Mark done" affordance. Surfacing this here closes the loop the review
 * worklist was missing: previously a doctor wrote review notes with zero
 * visibility into what the patient actually did day to day.
 */
function AdherenceSummary({ goals }: { goals: WeeklyPlanGoal[] }) {
  if (goals.length === 0) {
    return (
      <p className="text-xs text-charcoal-ink/50">No active weekly-plan goals for this programme yet.</p>
    );
  }

  const needsSupportCount = goals.filter((g) => g.streak.shouldRaiseWorklistItem && !goalDone(g)).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-charcoal-ink/70">Weekly plan</span>
        {needsSupportCount > 0 ? (
          <Badge variant="amber">
            {needsSupportCount} of {goals.length} needs support
          </Badge>
        ) : (
          <Badge variant="green">On track</Badge>
        )}
      </div>
      <ul className="space-y-1">
        {goals.map((goal) => (
          <li key={goal.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-charcoal-ink/80">
              {LPE_MODULE_LABEL[goal.module]} · {goal.title}
            </span>
            <span
              className={
                goal.streak.shouldRaiseWorklistItem
                  ? "shrink-0 text-amber-700"
                  : "shrink-0 text-charcoal-ink/50"
              }
            >
              {goal.streak.currentStreak > 0
                ? `${goal.streak.currentStreak}-day streak`
                : goal.streak.recentMisses > 0
                  ? `${goal.streak.recentMisses} missed in a row`
                  : "no data yet"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LifestyleReviewsClient({ reviews }: { reviews: PendingReview[] }) {
  if (reviews.length === 0) {
    return (
      <Card>
        <CardContent className="text-charcoal-ink/60 py-8 text-center text-sm">
          Nothing waiting. All lifestyle reviews are up to date.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {reviews.map((r) => (
        <ReviewRow key={r.id} review={r} />
      ))}
    </div>
  );
}

function ReviewRow({ review }: { review: PendingReview }) {
  const [state, submit] = useActionState<ReviewState, FormData>(completeReview, undefined);
  const overdue = new Date(review.dueDate) < new Date();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{review.patientName}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="grey" className="capitalize">
            {review.condition}
          </Badge>
          <Badge variant={overdue ? "red" : "blue"}>
            Due {new Date(review.dueDate).toLocaleDateString()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <AdherenceSummary goals={review.goals} />
        <form action={submit} className="flex flex-wrap items-end gap-2 border-t border-charcoal-ink/10 pt-3">
          <input type="hidden" name="reviewId" value={review.id} />
          <div className="min-w-[220px] flex-1">
            <Input name="notes" placeholder="Review notes (optional)" />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Complete review
          </Button>
        </form>
        {state?.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  );
}

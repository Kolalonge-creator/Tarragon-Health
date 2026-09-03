"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePatientGoals, usePatientMilestones } from "@/lib/queries/patient-goals";
import {
  createPatientGoalAction,
  logGoalProgressAction,
  markGoalAchievedAction,
  type GoalActionState,
} from "./goals-actions";
import { PATIENT_GOAL_TYPES } from "@/lib/validation/patient-goal";
import { startOfLagosDayUtc } from "@/lib/ai-coach/lagos-day";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEMANTIC_ICON } from "@/lib/icons";

const GOAL_TYPE_LABEL: Record<(typeof PATIENT_GOAL_TYPES)[number], string> = {
  walk_more: "Walk more",
  reduce_weight: "Reduce weight",
  improve_bp: "Improve blood pressure",
  medication_consistency: "Take medication consistently",
  complete_screening: "Complete a screening",
  stop_smoking: "Stop smoking",
  custom: "Something else",
};

const MILESTONE_COPY: Record<string, string> = {
  monitoring_streak_30d: "30 days of monitoring completed",
  medication_adherence_90pct_month: "90%+ medication adherence this month",
  preventive_assessment_completed: "Preventive assessment completed",
  patient_goal_achieved: "Goal achieved",
  engagement_recovery: "Back on track — great to have you back",
};

function todayLagosDateString(): string {
  return startOfLagosDayUtc(new Date()).toISOString().slice(0, 10);
}

/**
 * §16.10-16.12 — personal goals, daily progress logging, and milestones.
 * Sits in the "discretionary / engagement surfaces" band of the Care &
 * support page alongside WellnessPointsSummary, matching that section's
 * existing priority (real feature, not clinical, so it never competes with
 * care content above it).
 */
export function GoalsAndMilestonesCard({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const goals = usePatientGoals(patientId);
  const milestones = usePatientMilestones(patientId, 5);
  const [addingGoal, setAddingGoal] = useState(false);

  const [addState, addFormAction] = useActionState<GoalActionState, FormData>(
    async (prev, formData) => {
      const result = await createPatientGoalAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: ["patient-goals", patientId] });
        setAddingGoal(false);
      }
      return result;
    },
    undefined
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.challenge className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your goals
        </CardTitle>
        {!addingGoal && (
          <Button size="sm" variant="outline" onClick={() => setAddingGoal(true)}>
            + Add a goal
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {addingGoal && (
          <form action={addFormAction} className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
            <div className="grid gap-1">
              <Label htmlFor="goal_type">What kind of goal?</Label>
              <select
                id="goal_type"
                name="goal_type"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="walk_more"
              >
                {PATIENT_GOAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {GOAL_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="description">Describe it in your own words</Label>
              <Input id="description" name="description" placeholder="Walk 5,000 steps a day" required maxLength={300} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="target_value">Target (optional)</Label>
                <Input id="target_value" name="target_value" type="number" step="0.1" min={0} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="target_unit">Unit (optional)</Label>
                <Input id="target_unit" name="target_unit" placeholder="steps/day" maxLength={40} />
              </div>
            </div>
            {addState?.error && <p className="text-sm text-destructive">{addState.error}</p>}
            <div className="flex gap-2">
              <Button type="submit">Save goal</Button>
              <Button type="button" variant="outline" onClick={() => setAddingGoal(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {goals.isLoading && <p className="text-sm text-charcoal-ink/60">Loading your goals…</p>}
        {!goals.isLoading && (goals.data?.length ?? 0) === 0 && !addingGoal && (
          <p className="text-sm text-charcoal-ink/60">
            No active goals yet — small, specific goals (like a daily step count) tend to stick
            best.
          </p>
        )}
        {goals.data?.map((goal) => <GoalRow key={goal.id} goal={goal} patientId={patientId} />)}

        {(milestones.data?.length ?? 0) > 0 && (
          <div className="border-t border-charcoal-ink/10 pt-3">
            <p className="mb-2 text-sm font-medium text-charcoal-ink">Recent milestones</p>
            <ul className="space-y-1.5">
              {milestones.data!.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm text-charcoal-ink">
                  <SEMANTIC_ICON.badge className="h-4 w-4 shrink-0 text-sprout-gold" strokeWidth={2} />
                  <span>{MILESTONE_COPY[m.milestone_type] ?? m.milestone_type}</span>
                  <span className="ml-auto shrink-0 text-xs text-charcoal-ink/50">
                    {new Date(m.achieved_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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

function GoalRow({
  goal,
  patientId,
}: {
  goal: { id: string; description: string; target_value: number | null; target_unit: string | null };
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const [logState, logFormAction] = useActionState<GoalActionState, FormData>(
    async (prev, formData) => {
      const result = await logGoalProgressAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: ["patient-goal-progress", goal.id] });
      }
      return result;
    },
    undefined
  );
  const [achieveState, achieveFormAction] = useActionState<GoalActionState, FormData>(
    async (prev, formData) => {
      const result = await markGoalAchievedAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: ["patient-goals", patientId] });
      }
      return result;
    },
    undefined
  );

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-charcoal-ink">{goal.description}</p>
        {goal.target_value != null && (
          <span className="shrink-0 text-xs text-charcoal-ink/60">
            Target: {goal.target_value}
            {goal.target_unit ? ` ${goal.target_unit}` : ""}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={logFormAction} className="flex items-center gap-2">
          <input type="hidden" name="goal_id" value={goal.id} />
          <input type="hidden" name="logged_date" value={todayLagosDateString()} />
          <Input
            name="value"
            type="number"
            step="0.1"
            min={0}
            placeholder="Today's value"
            className="h-8 w-32"
            required
          />
          <Button type="submit" size="sm" variant="outline">
            Log today
          </Button>
        </form>
        <form action={achieveFormAction}>
          <input type="hidden" name="goal_id" value={goal.id} />
          <Button type="submit" size="sm" variant="ghost">
            Mark achieved
          </Button>
        </form>
      </div>
      {(logState?.error || achieveState?.error) && (
        <p className="text-sm text-destructive">{logState?.error ?? achieveState?.error}</p>
      )}
    </div>
  );
}

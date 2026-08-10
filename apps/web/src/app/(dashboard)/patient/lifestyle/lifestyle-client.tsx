"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { enrollAction, type LifestyleActionState } from "./actions";
import type { LifestyleEnrollmentView, PastLifestyleGoalView } from "@/lib/lifestyle/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoalsDialog } from "./goals-dialog";
import { ConditionEnrollmentCard } from "./condition-enrollment-card";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { useWeightGoal } from "@/lib/queries/weight-goal";
import { useLatestWeightKg } from "@/lib/queries/vitals";
import { useActivityGoal, useTodaySteps } from "@/lib/queries/activity";
import { useWellnessPointsBalance } from "@/lib/queries/wellness";
import { obesityLabelTitleCase } from "@/lib/copy/condition-language";

const TRACKERS = [
  {
    href: "/patient/nutrition",
    label: "Meals",
    description: "Log what you eat, with a photo if you like",
    icon: SEMANTIC_ICON.aiCoach,
  },
  {
    href: "/patient/weight",
    label: "Weight",
    description: "Track progress against a goal you set",
    icon: SEMANTIC_ICON.weight,
  },
  {
    href: "/patient/activity",
    label: "Activity",
    description: "Log steps and workouts",
    icon: SEMANTIC_ICON.steps,
  },
  {
    href: "/patient/wellness",
    label: "Rewards",
    description: "Points, badges, and challenges",
    icon: NAV_ICON.wellness,
  },
] as const;

/**
 * Single "where am I today" panel so a patient doesn't have to visit four
 * separate pages to see their own state — weight, steps, and points are
 * pulled inline here; each tile still links out to its own page to log or
 * edit. Nothing here is a new source of truth: every number is read from the
 * same tables/hooks their own dedicated pages already use.
 */
export function AtAGlancePanel({ patientId }: { patientId: string }) {
  const { data: weightGoal } = useWeightGoal(patientId);
  const { data: latestWeight } = useLatestWeightKg(patientId);
  const { data: activityGoal } = useActivityGoal(patientId);
  const { data: todaySteps } = useTodaySteps(patientId);
  const { data: pointsBalance } = useWellnessPointsBalance(patientId);

  const weightLine = (() => {
    if (!latestWeight?.weight_kg) return "Log a weight to start tracking";
    const current = latestWeight.weight_kg;
    if (!weightGoal?.goal_weight_kg) return `${current} kg logged`;
    const remaining = current - weightGoal.goal_weight_kg;
    if (Math.abs(remaining) < 0.1) return `${current} kg — at your goal`;
    return remaining > 0
      ? `${current} kg — ${remaining.toFixed(1)} kg to your ${weightGoal.goal_weight_kg} kg goal`
      : `${current} kg — ${Math.abs(remaining).toFixed(1)} kg past your ${weightGoal.goal_weight_kg} kg goal`;
  })();

  const stepGoal = activityGoal?.daily_step_goal ?? 7500;
  const steps = todaySteps ?? 0;
  const stepsLine = `${steps.toLocaleString()} of ${stepGoal.toLocaleString()} steps today`;

  const points = pointsBalance?.balance ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Where you are today</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-charcoal-ink/10 p-3">
            <div className="flex items-center gap-2 text-charcoal-ink/60">
              <SEMANTIC_ICON.weight className="h-4 w-4" strokeWidth={2} />
              <span className="text-xs">Weight</span>
            </div>
            <p className="mt-1 text-sm font-medium text-charcoal-ink">{weightLine}</p>
          </div>
          <div className="rounded-lg border border-charcoal-ink/10 p-3">
            <div className="flex items-center gap-2 text-charcoal-ink/60">
              <SEMANTIC_ICON.steps className="h-4 w-4" strokeWidth={2} />
              <span className="text-xs">Activity</span>
            </div>
            <p className="mt-1 text-sm font-medium text-charcoal-ink">{stepsLine}</p>
          </div>
          <div className="rounded-lg border border-charcoal-ink/10 p-3">
            <div className="flex items-center gap-2 text-charcoal-ink/60">
              <NAV_ICON.wellness className="h-4 w-4" strokeWidth={2} />
              <span className="text-xs">Rewards</span>
            </div>
            <p className="mt-1 text-sm font-medium text-charcoal-ink">
              {points.toLocaleString()} points banked
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {TRACKERS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col gap-2 rounded-lg border border-charcoal-ink/10 p-4 transition-colors hover:border-brand-green hover:bg-soft-sage"
            >
              <Icon className="h-5 w-5 text-deep-forest" strokeWidth={2} />
              <span className="text-sm font-medium text-charcoal-ink">{label}</span>
              <span className="text-xs text-charcoal-ink/60">{description}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function enrollableFor(
  preference: string | null | undefined,
): { key: "obesity" | "htn" | "diabetes"; label: string }[] {
  return [
    { key: "obesity", label: `${obesityLabelTitleCase(preference)} & lifestyle` },
    { key: "htn", label: "Blood pressure" },
    { key: "diabetes", label: "Diabetes" },
  ];
}

export function LifestyleClient({
  patientId,
  enrollments,
  pastGoals,
  conditionLanguagePreference,
}: {
  patientId: string;
  enrollments: LifestyleEnrollmentView[];
  pastGoals: PastLifestyleGoalView[];
  conditionLanguagePreference?: string | null;
}) {
  const [enrollState, enroll] = useActionState<LifestyleActionState, FormData>(
    enrollAction,
    undefined,
  );
  const [consented, setConsented] = useState(false);
  const enrolledConditions = new Set(enrollments.map((e) => e.conditionKey));
  const available = enrollableFor(conditionLanguagePreference).filter(
    (c) => !enrolledConditions.has(c.key),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your lifestyle programme</h1>
          <p className="text-muted-foreground text-sm">
            Small, steady changes, logged here, supported by your care team.
          </p>
        </div>
        <GoalsDialog enrollments={enrollments} pastGoals={pastGoals} />
      </div>

      <AtAGlancePanel patientId={patientId} />

      {enrollments.map((e) => (
        <ConditionEnrollmentCard key={e.id} enrollment={e} />
      ))}

      {available.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Start a programme</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {enrollState?.message && (
              <p className="text-sm text-brand-green">{enrollState.message}</p>
            )}
            {enrollState?.error && (
              <p className="text-sm text-destructive">{enrollState.error}</p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span className="text-muted-foreground">
                I agree that my logged readings and check-ins can be reviewed by
                my Tarragon care team to support this programme, and I can
                withdraw at any time.
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {available.map((c) => (
                <form key={c.key} action={enroll}>
                  <input type="hidden" name="conditionKey" value={c.key} />
                  <input
                    type="hidden"
                    name="consent"
                    value={consented ? "on" : "off"}
                  />
                  <Button type="submit" variant="outline" disabled={!consented}>
                    {c.label}
                  </Button>
                </form>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

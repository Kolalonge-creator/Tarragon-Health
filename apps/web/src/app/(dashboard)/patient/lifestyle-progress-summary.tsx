"use client";

import Link from "next/link";
import { useWeightGoal } from "@/lib/queries/weight-goal";
import { useLatestWeightKg } from "@/lib/queries/vitals";
import { useTodaySteps, useActivityGoal } from "@/lib/queries/activity";
import { Card, CardContent } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Compact dashboard teaser for the lifestyle/weight/activity hub at
 * /patient/lifestyle — the one thing the dashboard was missing entirely: a
 * patient managing their weight had no way to reach that page except the
 * sidebar. Mirrors WellnessPointsSummary's shape so the two sit consistently.
 */
export function LifestyleProgressSummary({ patientId }: { patientId: string }) {
  const { data: weightGoal } = useWeightGoal(patientId);
  const { data: latestWeight } = useLatestWeightKg(patientId);
  const { data: activityGoal } = useActivityGoal(patientId);
  const { data: todaySteps } = useTodaySteps(patientId);

  const headline = (() => {
    if (!latestWeight?.weight_kg) return "Track your weight & activity";
    if (!weightGoal?.goal_weight_kg) return `${latestWeight.weight_kg} kg logged`;
    const remaining = latestWeight.weight_kg - weightGoal.goal_weight_kg;
    if (Math.abs(remaining) < 0.1) return `${latestWeight.weight_kg} kg, at your goal`;
    return remaining > 0
      ? `${remaining.toFixed(1)} kg to your goal`
      : `${Math.abs(remaining).toFixed(1)} kg past your goal`;
  })();

  const stepGoal = activityGoal?.daily_step_goal ?? 7500;
  const steps = todaySteps ?? 0;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <SEMANTIC_ICON.weight className="h-8 w-8 text-brand-green" strokeWidth={2} />
          <div>
            <p className="font-heading text-xl font-bold text-charcoal-ink">{headline}</p>
            <p className="text-xs text-charcoal-ink/60">
              {steps.toLocaleString()} of {stepGoal.toLocaleString()} steps today · meals, weight,
              activity, exercise, sleep, smoking, alcohol &amp; rewards
            </p>
          </div>
        </div>
        <Link href="/patient/lifestyle" className="text-sm font-medium text-brand-green hover:underline">
          View →
        </Link>
      </CardContent>
    </Card>
  );
}

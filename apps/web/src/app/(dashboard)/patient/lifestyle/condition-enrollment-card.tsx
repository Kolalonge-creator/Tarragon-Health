"use client";

import { useActionState } from "react";
import {
  logReadingAction,
  resolveGoalAction,
  type LifestyleActionState,
} from "./actions";
import type { LifestyleEnrollmentView } from "@/lib/lifestyle/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * One enrolled condition's lifestyle-programme card — phase, goals, next
 * review, quick check-in. Extracted so both `/patient/lifestyle` (every
 * enrolled condition) and `/patient/weight-management` (obesity only) render
 * the exact same enrollment/logging behaviour instead of two copies drifting
 * apart.
 */
export function ConditionEnrollmentCard({ enrollment }: { enrollment: LifestyleEnrollmentView }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">
          {enrollment.programmeName ?? enrollment.condition}
        </CardTitle>
        <StatusBadge status={enrollment.status} />
      </CardHeader>
      <CardContent className="space-y-4">
        {enrollment.status === "paused" ? (
          <p className="text-sm text-muted-foreground">
            This programme is paused while your care team checks in with you.
            We&apos;re here to support you.
          </p>
        ) : (
          <>
            {enrollment.currentPhaseName && (
              <p className="text-sm">
                Current phase:{" "}
                <span className="font-medium">{enrollment.currentPhaseName}</span>
              </p>
            )}
            {enrollment.goals.length > 0 && (
              <ul className="space-y-2 text-sm">
                {enrollment.goals.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="text-muted-foreground capitalize">{g.module}</span>{" "}
                      {g.title}
                    </span>
                    {g.personalised && <ResolveGoalControls goalId={g.id} />}
                  </li>
                ))}
              </ul>
            )}
            {enrollment.nextReviewDue && (
              <p className="text-muted-foreground text-xs">
                Next care-team review:{" "}
                {new Date(enrollment.nextReviewDue).toLocaleDateString()}
              </p>
            )}
            {enrollment.conditionKey && (
              <LogForm enrollmentId={enrollment.id} conditionKey={enrollment.conditionKey} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "paused" ? "amber" : status === "active" ? "green" : "grey";
  return <Badge variant={tone}>{status}</Badge>;
}

function LogForm({
  enrollmentId,
  conditionKey,
}: {
  enrollmentId: string;
  conditionKey: "obesity" | "htn" | "diabetes";
}) {
  const [state, log] = useActionState<LifestyleActionState, FormData>(
    logReadingAction,
    undefined,
  );
  return (
    <form action={log} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <input type="hidden" name="conditionKey" value={conditionKey} />
      <p className="text-sm font-medium">Quick check-in</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`type-${enrollmentId}`}>What are you logging?</Label>
          <select
            id={`type-${enrollmentId}`}
            name="type"
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            defaultValue="mood"
          >
            <option value="mood">How I&apos;m feeling</option>
            <option value="weight">Weight (kg)</option>
            <option value="activity_minutes">Active minutes</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`value-${enrollmentId}`}>Value</Label>
          <Input
            id={`value-${enrollmentId}`}
            name="value"
            type="number"
            step="any"
            placeholder="e.g. 3"
          />
        </div>
      </div>

      {conditionKey === "obesity" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="strugglingWithFood" />
          I&apos;ve been struggling with food or eating lately
        </label>
      )}

      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" size="sm">
        Log check-in
      </Button>
    </form>
  );
}

function ResolveGoalControls({ goalId }: { goalId: string }) {
  const [state, resolve] = useActionState<LifestyleActionState, FormData>(
    resolveGoalAction,
    undefined,
  );

  if (state?.success) {
    return <span className="text-xs text-brand-green">{state.message}</span>;
  }

  return (
    <span className="flex shrink-0 gap-2">
      <form action={resolve}>
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="status" value="achieved" />
        <button type="submit" className="text-xs text-brand-green hover:underline">
          Mark achieved
        </button>
      </form>
      <form action={resolve}>
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="status" value="abandoned" />
        <button type="submit" className="text-xs text-muted-foreground hover:underline">
          Let this go
        </button>
      </form>
    </span>
  );
}

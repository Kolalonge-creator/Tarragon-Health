"use client";

import { useActionState, useState } from "react";
import { enrollAction, type LifestyleActionState } from "@/app/(dashboard)/patient/lifestyle/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Obesity-only enrollment prompt for a patient with no active programme yet.
 * Same enrollAction/consent pattern as the "Start a programme" card on
 * /patient/lifestyle, scoped to a single condition rather than offering
 * all three — a patient who came here specifically for weight management
 * shouldn't be asked to also consider blood pressure/diabetes enrollment.
 */
export function WeightEnrollCta({ label }: { label: string }) {
  const [state, enroll] = useActionState<LifestyleActionState, FormData>(
    enrollAction,
    undefined,
  );
  const [consented, setConsented] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Start your {label.toLowerCase()} programme</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">
          A structured programme with goals you set, weekly check-ins, and doctor review, at
          your pace.
        </p>
        {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
          />
          <span className="text-muted-foreground">
            I agree that my logged readings and check-ins can be reviewed by my Tarragon care
            team to support this programme, and I can withdraw at any time.
          </span>
        </label>
        <form action={enroll}>
          <input type="hidden" name="conditionKey" value="obesity" />
          <input type="hidden" name="consent" value={consented ? "on" : "off"} />
          <Button type="submit" disabled={!consented}>
            Start now
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

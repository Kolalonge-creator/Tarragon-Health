"use client";

import { useActionState, useState } from "react";
import { requestEmergencyContraception } from "./emergency-contraception-actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NAV_ICON } from "@/lib/icons";

/**
 * Emergency contraception fast track (spec §47.8) — deliberately its own
 * standalone, visually prominent card rather than a row in the routine
 * contraception panel, because "timing can be clinically important" here.
 * Prominent means a bolder brand accent (sprout-gold, the mark's own warm
 * tone), never fear-based/red "WARNING" styling — this is urgent, not scary,
 * and there is almost always still something a clinician can do.
 */
export function EmergencyContraceptionCard() {
  const [state, formAction, pending] = useActionState(requestEmergencyContraception, undefined);
  const [notSure, setNotSure] = useState(false);

  if (state?.success) {
    return (
      <Card className="border-2 border-sprout-gold bg-sprout-gold/5 dark:bg-sprout-gold/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-deep-forest dark:text-brand-green-bright">
            <NAV_ICON.warning className="h-5 w-5 text-sprout-gold" strokeWidth={2} />
            Request received
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          <p>{state.guidance}</p>
          <p className="rounded-md bg-white dark:bg-night-card p-3 font-medium text-deep-forest dark:text-brand-green-bright">
            Your care team has been notified and will follow up quickly.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-sprout-gold bg-sprout-gold/5 dark:bg-sprout-gold/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-deep-forest dark:text-brand-green-bright">
          <NAV_ICON.warning className="h-5 w-5 text-sprout-gold" strokeWidth={2} />
          Need emergency contraception?
        </CardTitle>
        <CardDescription className="text-charcoal-ink/70 dark:text-night-ink/70">
          Timing matters here, but there is almost always still something that can help. Tell us
          roughly when, and your care team will follow up fast.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hours_since_intercourse">Hours since intercourse</Label>
            <Input
              id="hours_since_intercourse"
              name="hours_since_intercourse"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="e.g. 6"
              disabled={notSure}
            />
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              <input
                type="checkbox"
                checked={notSure}
                onChange={(event) => setNotSure(event.target.checked)}
                className="h-4 w-4"
              />
              I&apos;m not sure
            </label>
          </div>

          {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

          <Button
            type="submit"
            disabled={pending}
            className="w-full bg-sprout-gold text-clinical-navy dark:text-night-ink hover:bg-sprout-gold/90"
          >
            {pending ? "Sending…" : "Request emergency contraception"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

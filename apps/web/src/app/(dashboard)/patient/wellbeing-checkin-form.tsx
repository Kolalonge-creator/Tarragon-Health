"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logWellbeingCheckin, updateWellbeingCheckinFrequency } from "./wellbeing-actions";
import {
  wellbeingCheckinsKey,
  wellbeingPreferenceKey,
  useWellbeingCheckinPreference,
} from "@/lib/queries/wellbeing";
import { WELLBEING_SCALE_QUESTIONS } from "@/lib/validation/wellbeing";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SCALE = [1, 2, 3, 4, 5] as const;

function ScaleQuestion({ name, prompt, low, high }: { name: string; prompt: string; low: string; high: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-charcoal-ink dark:text-night-ink">{prompt}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {SCALE.map((value) => (
          <label
            key={value}
            className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 px-1.5 py-1.5 text-xs text-charcoal-ink/70 dark:text-night-ink/70 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
          >
            <input type="radio" name={name} value={value} required className="accent-[color:var(--brand-green,#0E7C52)]" />
            {value}
          </label>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-charcoal-ink/50 dark:text-night-ink/55">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}

/**
 * Quick wellbeing self check-in (Module 46 §46.2/§46.13) — mood, stress,
 * sleep, activity, each a 1-5 scale, plus an optional note. Deliberately
 * optional and never blocking, same framing as the mental-health screen.
 */
export function WellbeingCheckinForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(logWellbeingCheckin, undefined);
  const queryClient = useQueryClient();
  const { data: preference } = useWellbeingCheckinPreference(patientId);
  const [freqState, freqAction, freqPending] = useActionState(updateWellbeingCheckinFrequency, undefined);

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: wellbeingCheckinsKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  useEffect(() => {
    if (freqState?.success) {
      queryClient.invalidateQueries({ queryKey: wellbeingPreferenceKey(patientId) });
    }
  }, [freqState?.success, queryClient, patientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How are you doing today?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={formAction} className="space-y-5">
          {WELLBEING_SCALE_QUESTIONS.map((q) => (
            <ScaleQuestion key={q.name} name={q.name} prompt={q.prompt} low={q.low} high={q.high} />
          ))}

          {state?.error && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green dark:text-brand-green-bright">Check-in saved.</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save check-in"}
          </Button>
        </form>

        <form action={freqAction} className="flex items-end gap-3 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="reminder_frequency_days">Remind me to check in every</Label>
            <Select
              id="reminder_frequency_days"
              name="reminder_frequency_days"
              defaultValue={String(preference?.reminder_frequency_days ?? 7)}
              className="w-40"
            >
              <option value="1">Day</option>
              <option value="3">3 days</option>
              <option value="7">Week</option>
              <option value="14">2 weeks</option>
              <option value="30">Month</option>
            </Select>
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={freqPending}>
            {freqPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitMentalHealthScreen } from "./mental-health-actions";
import { mentalHealthKey } from "@/lib/queries/mental-health";
import {
  FREQUENCY_OPTIONS,
  PHQ9_QUESTIONS,
  GAD7_QUESTIONS,
  AUDITC_QUESTIONS,
} from "@/lib/validation/mental-health-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function FrequencyQuestion({ name, prompt }: { name: string; prompt: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-charcoal-ink">{prompt}</legend>
      <div className="grid gap-1.5 sm:grid-cols-4">
        {FREQUENCY_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-2.5 py-1.5 text-xs text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
          >
            <input type="radio" name={name} value={opt.value} required className="accent-[color:var(--brand-green,#0E7C52)]" />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Intake mental-health screen (AHC pathway §11). Deliberately optional and
 * never blocking. Warm framing, no fear-based copy; a positive self-harm
 * answer is handled by the server (emergency pathway) and acknowledged
 * supportively here.
 */
export function MentalHealthScreenForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(submitMentalHealthScreen, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: mentalHealthKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  if (state?.success) {
    return (
      <Card variant="soft">
        <CardHeader>
          <CardTitle className="text-base">Thanks for checking in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-charcoal-ink/80">
          <p>Your answers are saved and your care team can see them.</p>
          {state.crisis && (
            <p className="rounded-md bg-red-50 p-3 text-red-700">
              You told us you have had thoughts of harming yourself. You are not alone — a member
              of your care team will reach out. If you are in immediate danger, please contact
              emergency services or go to the nearest hospital now.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mental wellbeing check-in</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-charcoal-ink/70">
          Over the last two weeks, how often have you been bothered by the following? This is a
          normal part of a whole-body check — your answers stay private to your care team.
        </p>
        <form action={formAction} className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
              How you have been feeling
            </h3>
            {PHQ9_QUESTIONS.map((prompt, i) => (
              <FrequencyQuestion key={`phq9_${i + 1}`} name={`phq9_${i + 1}`} prompt={prompt} />
            ))}
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
              Worry and anxiety
            </h3>
            {GAD7_QUESTIONS.map((prompt, i) => (
              <FrequencyQuestion key={`gad7_${i + 1}`} name={`gad7_${i + 1}`} prompt={prompt} />
            ))}
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
              Alcohol
            </h3>
            {AUDITC_QUESTIONS.map((q, i) => (
              <fieldset key={`auditc_${i + 1}`} className="space-y-2">
                <legend className="text-sm text-charcoal-ink">{q.prompt}</legend>
                <div className="grid gap-1.5 sm:grid-cols-5">
                  {q.options.map((label, value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-2.5 py-1.5 text-xs text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
                    >
                      <input
                        type="radio"
                        name={`auditc_${i + 1}`}
                        value={value}
                        required
                        className="accent-[color:var(--brand-green,#0E7C52)]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save check-in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

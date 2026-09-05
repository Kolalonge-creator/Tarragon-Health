"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitMentalHealthScreen } from "./mental-health-actions";
import { mentalHealthKey } from "@/lib/queries/mental-health";
import {
  FREQUENCY_OPTIONS,
  PHQ9_QUESTIONS,
  GAD7_QUESTIONS,
  AUDITC_QUESTIONS,
  EPDS_QUESTIONS,
} from "@/lib/validation/mental-health-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function FrequencyQuestion({ name, prompt }: { name: string; prompt: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-charcoal-ink dark:text-night-ink">{prompt}</legend>
      <div className="grid gap-1.5 sm:grid-cols-4">
        {FREQUENCY_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 px-2.5 py-1.5 text-xs text-charcoal-ink/80 dark:text-night-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
          >
            <input type="radio" name={name} value={opt.value} required className="accent-[color:var(--brand-green,#0E7C52)]" />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Per-question option set (AUDIT-C, EPDS) — each question has its own scale
 * rather than sharing FREQUENCY_OPTIONS. */
function OwnScaleQuestion({
  name,
  prompt,
  options,
  required = true,
}: {
  name: string;
  prompt: string;
  options: readonly string[];
  required?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-charcoal-ink dark:text-night-ink">{prompt}</legend>
      <div className="grid gap-1.5 sm:grid-cols-4">
        {options.map((label, value) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 px-2.5 py-1.5 text-xs text-charcoal-ink/80 dark:text-night-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
          >
            <input
              type="radio"
              name={name}
              value={value}
              required={required}
              className="accent-[color:var(--brand-green,#0E7C52)]"
            />
            {label}
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
  const [isPerinatal, setIsPerinatal] = useState(false);

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
        <CardContent className="space-y-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          <p>Your answers are saved and your care team can see them.</p>
          {state.crisis && (
            <p className="rounded-md bg-red-50 dark:bg-red-500/15 p-3 text-red-700 dark:text-red-300">
              You told us you have had thoughts of harming yourself. You are not alone. A member
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
        <p className="mb-4 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Over the last two weeks, how often have you been bothered by the following? This is a
          normal part of a whole-body check, and your answers stay private to your care team.
        </p>
        <form action={formAction} className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
              How you have been feeling
            </h3>
            {PHQ9_QUESTIONS.map((prompt, i) => (
              <FrequencyQuestion key={`phq9_${i + 1}`} name={`phq9_${i + 1}`} prompt={prompt} />
            ))}
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
              Worry and anxiety
            </h3>
            {GAD7_QUESTIONS.map((prompt, i) => (
              <FrequencyQuestion key={`gad7_${i + 1}`} name={`gad7_${i + 1}`} prompt={prompt} />
            ))}
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
              Alcohol
            </h3>
            {AUDITC_QUESTIONS.map((q, i) => (
              <OwnScaleQuestion key={`auditc_${i + 1}`} name={`auditc_${i + 1}`} prompt={q.prompt} options={q.options} />
            ))}
          </div>

          <div className="space-y-3 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-charcoal-ink dark:text-night-ink">
              <input
                type="checkbox"
                name="is_perinatal"
                value="true"
                checked={isPerinatal}
                onChange={(e) => setIsPerinatal(e.target.checked)}
                className="accent-[color:var(--brand-green,#0E7C52)]"
              />
              I am currently pregnant, or have given birth in the last 12 months
            </label>
            {isPerinatal && (
              <div className="space-y-4 pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
                  How you have been feeling since your pregnancy or birth
                </h3>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  These extra questions are about the past 7 days, and are in addition to (not
                  instead of) the questions above.
                </p>
                {EPDS_QUESTIONS.map((q, i) => (
                  <OwnScaleQuestion
                    key={`epds_${i + 1}`}
                    name={`epds_${i + 1}`}
                    prompt={q.prompt}
                    options={q.options}
                    required={isPerinatal}
                  />
                ))}
              </div>
            )}
          </div>

          {state?.error && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save check-in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

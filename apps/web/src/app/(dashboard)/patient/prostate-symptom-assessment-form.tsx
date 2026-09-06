"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitProstateSymptomAssessment } from "./mens-health-actions";
import { mensHealthKey } from "@/lib/queries/mens-health";
import { IPSS_QUESTIONS } from "@/lib/validation/mens-health";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FREQUENCY_LABELS = ["Not at all", "Less than 1 in 5 times", "Less than half the time", "About half the time", "More than half the time", "Almost always"];

/**
 * Prostate urinary symptom self-assessment, IPSS (Men's Health §45.7).
 * PSA testing is never suggested from this score — see
 * lib/rules/prostate-symptom-scoring.ts's header — only from the
 * age/family-history question below, and even then only as a prompt to talk
 * to the care team (CLAUDE.md §45.7's guardrail against presenting PSA
 * testing as universally appropriate).
 */
export function ProstateSymptomAssessmentForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(submitProstateSymptomAssessment, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: mensHealthKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  if (state?.success) {
    return (
      <Card variant="soft">
        <CardHeader>
          <CardTitle className="text-base">Thanks for checking in</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-charcoal-ink/80">
          Your answers are saved and your care team can see them. If this is a good time for a
          conversation about prostate screening, they&apos;ll bring it up with you — it&apos;s a decision to
          make together, not a test that applies the same way to everyone.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Urinary symptom check-in</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-charcoal-ink/70">
          Over the last month, how often have you had the following? Most causes are benign
          (age-related prostate enlargement), and this is confidential to your care team.
        </p>
        <form action={formAction} className="space-y-5">
          {IPSS_QUESTIONS.map((prompt, i) => (
            <fieldset key={`ipss_${i + 1}`} className="space-y-2">
              <legend className="text-sm text-charcoal-ink">{prompt}</legend>
              <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
                {FREQUENCY_LABELS.map((label, value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-2 py-1.5 text-[11px] text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
                  >
                    <input
                      type="radio"
                      name={`ipss_${i + 1}`}
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

          <label className="flex cursor-pointer items-start gap-2 text-sm text-charcoal-ink">
            <input
              type="checkbox"
              name="family_history_prostate_cancer"
              className="mt-1 accent-[color:var(--brand-green,#0E7C52)]"
            />
            A father or brother has had prostate cancer
          </label>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

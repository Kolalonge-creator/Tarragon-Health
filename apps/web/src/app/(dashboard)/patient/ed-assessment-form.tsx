"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitEdAssessment } from "./mens-health-actions";
import { mensHealthKey } from "@/lib/queries/mens-health";
import { IIEF5_QUESTIONS } from "@/lib/validation/mens-health";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Erectile dysfunction self-assessment (Men's Health §45.5): "Patient reports
 * problem -> Structured assessment". Confidential, optional, never blocking —
 * same framing discipline as MentalHealthScreenForm. Scoring and the
 * cardiometabolic-coexistence flag are computed server-side.
 */
export function EdAssessmentForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(submitEdAssessment, undefined);
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
          <CardTitle className="text-base">Thanks for sharing this</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-charcoal-ink/80">
          <p>
            Your answers are saved and a member of your care team will follow up about a
            consultation. Erectile difficulty can sometimes be an early sign of a cardiovascular
            or metabolic issue, so they may also suggest checking your blood pressure, cholesterol
            and blood sugar alongside it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Erectile function check-in</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-charcoal-ink/70">
          Over the last 6 months. This is confidential, entirely optional, and stays private to
          your care team.
        </p>
        <form action={formAction} className="space-y-5">
          {IIEF5_QUESTIONS.map((q, i) => (
            <fieldset key={`ed_${i + 1}`} className="space-y-2">
              <legend className="text-sm text-charcoal-ink">{q.prompt}</legend>
              <div className="grid gap-1.5 sm:grid-cols-5">
                {q.options.map((label, index) => (
                  <label
                    key={label}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-2.5 py-1.5 text-xs text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
                  >
                    <input
                      type="radio"
                      name={`ed_${i + 1}`}
                      value={index + 1}
                      required
                      className="accent-[color:var(--brand-green,#0E7C52)]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

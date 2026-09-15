"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitMaleFertilityAssessment } from "./mens-health-actions";
import { mensHealthKey } from "@/lib/queries/mens-health";
import { MALE_FERTILITY_RISK_FACTOR_LABEL } from "@/lib/rules/male-fertility-assessment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PRIOR_SEMEN_ANALYSIS_LABEL: Record<string, string> = {
  none: "I haven't had one",
  normal: "Yes, and it came back normal",
  abnormal: "Yes, and it came back abnormal",
  pending: "One is booked / results are pending",
};

/**
 * Male fertility intake (Men's Health §45.6): education/assessment step. A
 * suggested semen analysis routes to the care team via the table's own
 * AFTER INSERT trigger; an actual specialist referral remains a staff
 * action, matching specialist_referrals' staff-write-only RLS.
 */
export function MaleFertilityAssessmentForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(submitMaleFertilityAssessment, undefined);
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
          Your answers are saved. If a semen analysis looks like a reasonable next step, your care
          team will reach out about arranging one and, if needed, a specialist referral.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fertility check-in</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-charcoal-ink/70">
          For couples trying to conceive. Male factors are involved in a substantial share of
          cases, and many are treatable once identified.
        </p>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="trying_to_conceive_months">
              How many months have you and your partner been trying to conceive?
            </Label>
            <Input
              id="trying_to_conceive_months"
              name="trying_to_conceive_months"
              type="number"
              min={0}
              max={600}
              required
              className="max-w-[10rem]"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm text-charcoal-ink">
              Do any of these apply to you? (select all that apply)
            </legend>
            <div className="space-y-1.5">
              {Object.entries(MALE_FERTILITY_RISK_FACTOR_LABEL).map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-start gap-2 text-sm text-charcoal-ink/80">
                  <input
                    type="checkbox"
                    name="risk_factors"
                    value={value}
                    className="mt-0.5 accent-[color:var(--brand-green,#0E7C52)]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="prior_semen_analysis">Have you had a semen analysis before?</Label>
            <Select id="prior_semen_analysis" name="prior_semen_analysis" defaultValue="none">
              {Object.entries(PRIOR_SEMEN_ANALYSIS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

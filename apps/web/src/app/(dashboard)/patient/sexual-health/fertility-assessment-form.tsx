"use client";

import { useActionState, useState } from "react";
import { submitFertilityAssessment } from "./fertility-actions";
import { FertilityAssessmentResult } from "./fertility-assessment-result";
import {
  KNOWN_RISK_FACTORS,
  KNOWN_RISK_FACTOR_LABEL,
  type KnownRiskFactor,
} from "@/lib/validation/fertility-assessment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Fertility self-assessment (spec §47.9): trying-duration, an optional
 * cycle-regularity question, and known risk factors — leading to one of 4
 * recommended actions (recommendFertilityAction, computed server-side).
 * Selecting "None of these" clears any other risk factor and vice versa —
 * a UX nicety only; the safe-by-default server rule still treats any real
 * factor present as an override regardless of what else is checked.
 */
export function FertilityAssessmentForm() {
  const [state, formAction, pending] = useActionState(submitFertilityAssessment, undefined);
  const [riskFactors, setRiskFactors] = useState<KnownRiskFactor[]>([]);

  function toggleRiskFactor(factor: KnownRiskFactor, checked: boolean) {
    setRiskFactors((prev) => {
      if (factor === "none") return checked ? ["none"] : [];
      const withoutNone = prev.filter((f) => f !== "none");
      return checked ? [...withoutNone, factor] : withoutNone.filter((f) => f !== factor);
    });
  }

  if (state?.success && state.recommendedAction) {
    return <FertilityAssessmentResult recommendedAction={state.recommendedAction} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.carePlan className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Fertility check-in
        </CardTitle>
        <CardDescription>
          A few quick questions to point you toward the right next step — education, advice,
          baseline tests, or a specialist. Never a diagnosis.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="trying_duration_months">
              How many months have you been trying to conceive?
            </Label>
            <Input
              id="trying_duration_months"
              name="trying_duration_months"
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              required
              placeholder="e.g. 8"
              className="max-w-[10rem]"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-charcoal-ink">
              Is your menstrual cycle regular? (Skip if this doesn&apos;t apply to you)
            </legend>
            <div className="flex gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-3 py-2 text-sm text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5">
                <input type="radio" name="menstrual_cycle_regular" value="true" />
                Yes, regular
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-3 py-2 text-sm text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5">
                <input type="radio" name="menstrual_cycle_regular" value="false" />
                No, irregular
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-charcoal-ink">
              Do any of these apply to you or your partner?
            </legend>
            <div className="flex flex-wrap gap-2">
              {KNOWN_RISK_FACTORS.map((factor) => (
                <label
                  key={factor}
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-charcoal-ink/15 px-3 py-2 text-sm text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
                >
                  <input
                    type="checkbox"
                    name="known_risk_factors"
                    value={factor}
                    checked={riskFactors.includes(factor)}
                    onChange={(event) => toggleRiskFactor(factor, event.target.checked)}
                    className="h-4 w-4"
                  />
                  {KNOWN_RISK_FACTOR_LABEL[factor]}
                </label>
              ))}
            </div>
          </fieldset>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Get my recommendation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

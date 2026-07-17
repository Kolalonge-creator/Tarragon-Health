"use client";

import { useState } from "react";
import { RiskAssessmentForm } from "@/app/(dashboard)/patient/risk-assessment-form";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";
import { Button } from "@/components/ui/button";

/**
 * Step 3 of onboarding (Phase B): the guided health profile. Surfaces the
 * existing risk-assessment questionnaire (family history, lifestyle, medical
 * history, vaccination/screening) and current-medication logging as part of
 * the intake sequence rather than leaving them as cards a patient may never
 * find. Deliberately skippable — it must never block reaching the dashboard,
 * matching the app/web-first, non-coercive product philosophy.
 */
export function IntakeStep({
  patientId,
  onSkip,
}: {
  patientId: string;
  onSkip: () => void;
}) {
  const [showMeds, setShowMeds] = useState(false);

  return (
    <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          Your health profile
        </h2>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          A few questions help your care team start on the right foot. You can do this now or
          later from your dashboard.
        </p>
      </div>

      <RiskAssessmentForm patientId={patientId} />

      <div className="border-t border-charcoal-ink/10 pt-4">
        <h3 className="text-sm font-semibold text-charcoal-ink">Medicines you take now</h3>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          Add anything you&apos;re already taking so it&apos;s on your record.
        </p>
        {showMeds ? (
          <div className="mt-3">
            <AddMedicationForm patientId={patientId} source="patient" />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => setShowMeds(true)}
          >
            Add a medicine
          </Button>
        )}
      </div>

      <div className="border-t border-charcoal-ink/10 pt-4">
        <Button type="button" variant="ghost" onClick={onSkip}>
          Continue to choose your plan →
        </Button>
      </div>
    </div>
  );
}

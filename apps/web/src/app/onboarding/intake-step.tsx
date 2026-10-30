"use client";

import { useState } from "react";
import { RiskAssessmentForm } from "@/app/(dashboard)/patient/risk-assessment-form";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";
import { Button } from "@/components/ui/button";
import type { OnboardingIntent } from "./answers-step";

/** Keyed off the intent derived in answers-step.tsx — a straight copy swap,
 *  not a change to the questionnaire itself. Deliberately NOT used to open
 *  the assessment on a later section: every section's required fields
 *  (Lifestyle's in particular — smoking/alcohol/sleep/stress/height have no
 *  client-side enforcement on a hidden step) only get filled in if the
 *  patient actually visits them, so starting anywhere but section 1 risked
 *  a submission that silently failed validation with no way to find the
 *  missing section — caught in code review before this ever merged. */
const INTRO_COPY: Record<OnboardingIntent, string> = {
  manage: "We'll start with your medical history, so we understand the condition you're managing.",
  prevent:
    "We'll build a screening and vaccination calendar matched to your age, sex, and history.",
  unsure:
    "Four short sections build your personal prevention plan: a screening and vaccination " +
    "calendar matched to your age, sex, and history, whether you're managing a condition or " +
    "perfectly healthy and want to stay that way.",
};

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
  intent,
  sex,
}: {
  patientId: string;
  onSkip: () => void;
  /** Recorded sex from the step before, so the questionnaire can leave out questions that do not apply. */
  sex?: "male" | "female" | null;
  /** From answers-step.tsx — only changes which intro line is shown below. */
  intent: OnboardingIntent;
}) {
  const [showMeds, setShowMeds] = useState(false);

  return (
    <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          Your health profile
        </h2>
        {/* "Two minutes" sat in front of a four-part questionnaire plus a
            medication logger, which is not a two-minute job for most people.
            Saying what it is, rather than underselling how long it takes,
            costs nothing and is the difference between a promise kept and a
            small lie on the way in. */}
        <p className="mt-1 text-sm text-charcoal-ink/60">
          {INTRO_COPY[intent]} You can stop part-way, or do the whole thing later from your
          dashboard.
        </p>
        {/* The way out is at the top, where someone who does not want to answer will look, not only below the whole form. */}
        <Button type="button" variant="outline" className="mt-3" onClick={onSkip}>
          Skip this for now
        </Button>
        <p className="mt-1 text-xs text-charcoal-ink/50">
          You can fill this in later from your dashboard. Until you do, your screening calendar stays empty.
        </p>
      </div>

      <RiskAssessmentForm patientId={patientId} sex={sex} />

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
        {/* There is no plan step to continue to: plans were retired, and this
            button has always gone straight to the confirmation screen. */}
        <Button type="button" variant="ghost" onClick={onSkip}>
          Skip for now and go to the last step
        </Button>
        <p className="mt-1 text-xs text-charcoal-ink/50">
          Skipping is fine. Your screening calendar stays empty until this is done, and you can
          fill it in whenever you like.
        </p>
      </div>
    </div>
  );
}

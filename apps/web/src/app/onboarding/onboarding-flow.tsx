"use client";

import { useState, type ReactNode } from "react";
import { PatientLocationForm } from "@/app/(dashboard)/patient/patient-location-form";
import { EmergencyContactForm } from "@/app/(dashboard)/patient/emergency-contact-form";
import { ConsentStep } from "./consent-step";
import { DemographicsForm } from "./demographics-form";
import { IdentityVerificationCard } from "./identity-verification-card";
import { IntakeStep } from "./intake-step";
import { PlanSelector } from "./plan-selector";

function DoneRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-brand-green/20 bg-brand-green/[0.04] px-4 py-3">
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-green text-xs text-white"
      >
        ✓
      </span>
      <span className="text-sm font-medium text-charcoal-ink">{label}</span>
      <span className="ml-auto text-xs text-charcoal-ink/50">Done</span>
    </div>
  );
}

/**
 * Client-side onboarding orchestrator. Steps reveal in order:
 *   1. Consent (required)   2. About you — DOB/sex (required)
 *   3. Health profile (skippable)   4. Choose your plan
 * Required steps gate the plan step both here and structurally in the DB
 * (private.enforce_onboarding_prereqs), so this ordering can't be bypassed to
 * finish onboarding without consent + demographics.
 */
export function OnboardingFlow({
  profile,
  careTeamSlot,
  initial,
}: {
  profile: { id: string; fullName: string | null };
  /** Server-rendered <YourCareTeam/> passed in — it's an async server component. */
  careTeamSlot: ReactNode;
  initial: {
    consentDone: boolean;
    demographicsDone: boolean;
    intakeDone: boolean;
    dateOfBirth: string | null;
    sex: "male" | "female" | null;
    location: { state: string | null; city: string | null; area: string | null };
    emergencyContact: {
      emergency_contact_name: string | null;
      emergency_contact_phone: string | null;
      emergency_contact_relationship: string | null;
      emergency_contact_consent: boolean | null;
      next_of_kin_name: string | null;
      next_of_kin_phone: string | null;
    };
  };
}) {
  const [consentDone, setConsentDone] = useState(initial.consentDone);
  const [demographicsDone, setDemographicsDone] = useState(initial.demographicsDone);
  const [intakeCollapsed, setIntakeCollapsed] = useState(initial.intakeDone);

  const readyForPlan = consentDone && demographicsDone;

  return (
    <div className="w-full max-w-lg space-y-6">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-semibold text-brand-green">
          Welcome{profile.fullName ? `, ${profile.fullName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-charcoal-ink/60">Care that stays with you.</p>
      </div>

      <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          How your care works here
        </h2>
        <p className="text-sm text-charcoal-ink">
          A named doctor on our care team follows your readings, checks in with you, and
          documents your care as it happens — they&apos;re the person you&apos;ll actually hear
          from.
        </p>
        <p className="text-sm text-charcoal-ink">
          Your care protocols — the thresholds and rules your doctor follows — are designed and
          supervised by our Clinical Director.
        </p>
        <p className="text-sm text-charcoal-ink">
          If a reading or symptom meets specific clinical criteria, your case gets a doctor
          review, and you&apos;ll see exactly who reviewed it and when.
        </p>
      </div>

      {careTeamSlot}

      {/* Step 1 — Consent */}
      {consentDone ? (
        <DoneRow label="Your agreement" />
      ) : (
        <ConsentStep onComplete={() => setConsentDone(true)} />
      )}

      {/* Step 2 — Demographics + location (revealed after consent) */}
      {consentDone &&
        (demographicsDone ? (
          <DoneRow label="About you" />
        ) : (
          <DemographicsForm
            initial={{ dateOfBirth: initial.dateOfBirth, sex: initial.sex }}
            onComplete={() => setDemographicsDone(true)}
          />
        ))}

      {consentDone && demographicsDone && (
        <PatientLocationForm initial={initial.location} />
      )}

      {consentDone && demographicsDone && (
        <EmergencyContactForm initial={initial.emergencyContact} />
      )}

      {consentDone && demographicsDone && (
        <IdentityVerificationCard patientId={profile.id} />
      )}

      {/* Step 3 — Health profile (skippable) */}
      {readyForPlan && !intakeCollapsed && (
        <IntakeStep patientId={profile.id} onSkip={() => setIntakeCollapsed(true)} />
      )}

      {/* Step 4 — Plan */}
      {readyForPlan && intakeCollapsed && (
        <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
            Choose your plan
          </h2>
          <p className="text-sm text-charcoal-ink/60">
            Start free, or pick a paid plan now — you can change or cancel any time from your
            dashboard.
          </p>
          <PlanSelector />
        </div>
      )}

      {!readyForPlan && (
        <p className="text-center text-xs text-charcoal-ink/50">
          Complete the steps above to choose your plan.
        </p>
      )}
    </div>
  );
}

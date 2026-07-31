"use client";

import { useState, type ReactNode } from "react";
import { PatientLocationForm } from "@/app/(dashboard)/patient/patient-location-form";
import { ConsentStep } from "./consent-step";
import { DemographicsForm } from "./demographics-form";
import { IntakeStep } from "./intake-step";
import { PlanPreview } from "./plan-preview";
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
 *   1. Consent (required)   2. About you, DOB/sex (required)
 *   3. Where you are (finds labs near you)
 *   4. Health profile (skippable)   5. Choose your plan
 * Required steps gate the plan step both here and structurally in the DB
 * (private.enforce_onboarding_prereqs), so this ordering can't be bypassed to
 * finish onboarding without consent + demographics.
 *
 * Emergency contacts and identity verification were deliberately removed from
 * this flow and now live on the patient dashboard under Profile & settings.
 * Neither is required to start, both are already rendered there, and asking a
 * first-time visitor for next-of-kin details and a government ID number before
 * they have done anything was the heaviest friction in the signup path,
 * especially for a healthy person who only came to book one test.
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
          Most of what Tarragon does is keep track: your screening and vaccination dates, any
          readings you log, and the results that come back. Plenty of people here have nothing
          wrong with them and use it to stay that way.
        </p>
        <p className="text-sm text-charcoal-ink">
          The thresholds and rules behind all of it are designed and supervised by our Clinical
          Director, so what counts as worth acting on is not decided case by case.
        </p>
        <p className="text-sm text-charcoal-ink">
          If a result or symptom meets those criteria, it goes to a doctor for review, and
          you&apos;ll see exactly who reviewed it and when. That escalation runs on every plan,
          including the free one. Routine review of readings when nothing is flagged is part of
          the paid plans.
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

      {/* Location stays in the flow because it is the one answer that changes
          what we can show you next: it is how we find labs and clinics near
          you. Emergency contacts and identity verification used to sit here
          too; both are optional, neither is needed to start, and both now live
          on the dashboard under Profile & settings instead. */}
      {consentDone && demographicsDone && (
        <PatientLocationForm initial={initial.location} />
      )}

      {/* Step 3 — Health profile (skippable) */}
      {readyForPlan && !intakeCollapsed && (
        <IntakeStep patientId={profile.id} onSkip={() => setIntakeCollapsed(true)} />
      )}

      {/* Step 4 — what the intake produced (honest plan preview), then plan choice */}
      {readyForPlan && intakeCollapsed && <PlanPreview patientId={profile.id} />}
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

"use client";

import { useState, type ReactNode } from "react";
import { PatientLocationForm } from "@/app/(dashboard)/patient/patient-location-form";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "./actions";
import { ConsentStep } from "./consent-step";
import { DemographicsForm } from "./demographics-form";
import { IntakeStep } from "./intake-step";
import { PlanPreview } from "./plan-preview";

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
 *   4. Health profile (skippable)   5. Finish
 * Required steps are gated both here and structurally in the DB
 * (private.enforce_onboarding_prereqs), so this ordering can't be bypassed to
 * finish onboarding without consent + demographics.
 *
 * Episodic-fee rebuild: step 5 used to be a mandatory "choose your plan"
 * (subscription) step — removed. Onboarding now always ends with a plain
 * completion action; a patient buys a Health Check or a Care Programme
 * afterward, from the dashboard, whenever they actually want one. Nothing in
 * private.enforce_onboarding_prereqs ever required a plan, so this is a pure
 * UI removal, no DB change.
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
  receivesCare = true,
}: {
  profile: { id: string; fullName: string | null };
  /**
   * False means this person came to pay for someone else's care, not to
   * receive care. Being asked to consent to telehealth for themselves and
   * hand over their date of birth before they could give us money for their
   * mother was the first thing a sponsor hit, and it is a hard stop at the
   * highest-intent moment the product has.
   *
   * When they later choose to join as a patient too, this flips true and they
   * get the full flow below — including the intake questions, which is what
   * the screening calendar and risk scoring are actually built from.
   */
  receivesCare?: boolean;
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
  const [finishing, setFinishing] = useState(false);

  const readyToFinish = consentDone && demographicsDone;

  if (!receivesCare) {
    return <SupporterOnboarding profile={profile} done={consentDone} onDone={setConsentDone} />;
  }

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
      {readyToFinish && !intakeCollapsed && (
        <IntakeStep patientId={profile.id} onSkip={() => setIntakeCollapsed(true)} />
      )}

      {/* Step 4 — the honest intake-driven preview, then finish. No plan to
          choose or pay for any more — a Health Check or a Care Programme is
          bought later, from the dashboard, whenever the patient wants one. */}
      {readyToFinish && intakeCollapsed && (
        <>
          <PlanPreview patientId={profile.id} />
          <form
            action={async () => {
              setFinishing(true);
              await completeOnboarding();
            }}
          >
            <Button type="submit" disabled={finishing} className="w-full">
              {finishing ? "Setting up…" : "Go to your dashboard"}
            </Button>
          </form>
        </>
      )}

      {!readyToFinish && (
        <p className="text-center text-xs text-charcoal-ink/50">
          Complete the steps above to finish setting up your account.
        </p>
      )}
    </div>
  );
}

/**
 * The whole of setup for somebody who came to pay for a relative's care.
 *
 * One step: the terms they are transacting under. No telehealth consent, no
 * health-data consent, no date of birth, no plan for themselves — none of it
 * applies to a person who is not being treated, and asking for it was both
 * friction at the worst possible moment and a request for consent that would
 * not have been truthful.
 *
 * If they ever do want care for themselves, the rest is collected then;
 * private.enforce_care_purpose_switch makes that non-optional, so nothing is
 * skipped for anyone actually receiving care.
 */
function SupporterOnboarding({
  profile,
  done,
  onDone,
}: {
  profile: { id: string; fullName: string | null };
  done: boolean;
  onDone: (value: boolean) => void;
}) {
  const [finishing, setFinishing] = useState(false);

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
          Supporting someone&apos;s care
        </h2>
        <p className="text-sm text-charcoal-ink">
          You can pay for their plan, their checks and their refills, and see exactly what your
          money paid for. That part starts working as soon as you finish here.
        </p>
        <p className="text-sm text-charcoal-ink">
          What you cannot do is read their record by default. They keep their own account, and they
          decide whether you can follow how they are doing — from their side, and they can stop at
          any time. If they have not linked you yet, ask them to add you under &ldquo;Your
          people&rdquo;.
        </p>
        <p className="text-sm text-charcoal-ink/60">
          We are not asking you any health questions, because this account is not for treating you.
          If you ever want your own care here, you can set that up later.
        </p>
      </div>

      {done ? (
        <DoneRow label="Your agreement" />
      ) : (
        <ConsentStep
          onlyTypes={["terms_of_service"]}
          description="The terms you are paying under. Nothing here signs you up for care yourself."
          onComplete={() => onDone(true)}
        />
      )}

      {done && (
        <form
          action={async () => {
            setFinishing(true);
            await completeOnboarding();
          }}
        >
          <Button type="submit" disabled={finishing} className="w-full">
            {finishing ? "Setting up…" : "Go to the people you support"}
          </Button>
        </form>
      )}
    </div>
  );
}

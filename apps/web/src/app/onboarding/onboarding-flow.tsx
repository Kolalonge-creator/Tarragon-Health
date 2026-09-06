"use client";

import { useState, type ReactNode } from "react";
import { PatientLocationForm } from "@/app/(dashboard)/patient/patient-location-form";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "./actions";
import { ConsentStep } from "./consent-step";
import { DemographicsForm } from "./demographics-form";
import { IntakeStep } from "./intake-step";
import { PlanPreview } from "./plan-preview";
import { ReadyNotice } from "./ready-notice";
import { ExistingPlanNotice } from "./existing-plan-notice";

/**
 * A finished step. Previously an inert row: once a step collapsed into one of
 * these there was no way back into it, so a mistyped date of birth (which
 * drives every risk score and screening date on the platform) could not be
 * corrected without abandoning onboarding. `onReopen` makes it a real control.
 */
function DoneRow({
  label,
  detail,
  onReopen,
}: {
  label: string;
  /** What was actually saved, so the row is checkable at a glance. */
  detail?: string | null;
  onReopen?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-brand-green/20 bg-brand-green/[0.04] px-4 py-3">
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-green text-xs text-white"
      >
        ✓
      </span>
      <span className="min-w-0 text-sm font-medium text-charcoal-ink">
        {label}
        {detail ? (
          <span className="ml-2 font-normal text-charcoal-ink/60">{detail}</span>
        ) : null}
      </span>
      {onReopen ? (
        <button
          type="button"
          onClick={onReopen}
          className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-brand-green underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
        >
          Change<span className="sr-only"> {label.toLowerCase()}</span>
        </button>
      ) : (
        <span className="ml-auto text-xs text-charcoal-ink/50">Done</span>
      )}
    </div>
  );
}

const STEP_LABELS = ["Your agreement", "About you", "Health profile", "Finish"] as const;

/**
 * "Step 2 of 4", plus the named steps. There was no progress indicator of any
 * kind here: completed steps collapsed to a row and the remaining ones were
 * simply not rendered yet, so a first-time visitor could not tell whether they
 * were two steps from the end or ten.
 */
function OnboardingProgress({ current }: { current: number }) {
  return (
    <nav aria-label="Setup progress" className="space-y-2">
      <p className="text-center text-xs font-medium text-charcoal-ink/60">
        Step {current + 1} of {STEP_LABELS.length}: {STEP_LABELS[current]}
      </p>
      <ol className="flex items-center gap-1.5" role="list">
        {STEP_LABELS.map((label, index) => (
          <li
            key={label}
            className="flex-1"
            {...(index === current ? { "aria-current": "step" as const } : {})}
          >
            <span
              className={`block h-1.5 rounded-full ${
                index < current
                  ? "bg-brand-green"
                  : index === current
                    ? "bg-brand-green/60"
                    : "bg-charcoal-ink/10"
              }`}
            />
            <span className="sr-only">
              {label}
              {index < current ? " (done)" : index === current ? " (current)" : " (not started)"}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Client-side onboarding orchestrator. Four counted steps (see STEP_LABELS,
 * which is what OnboardingProgress shows the patient):
 *   1. Consent (required)   2. About you, DOB/sex (required)
 *   3. Health profile (skippable)   4. Confirmation (the app is free)
 * "Where you are" renders alongside step 2 rather than as a counted step of
 * its own: it is optional, it gates nothing, and the nearby-facility pickers
 * it was collected for are suspended platform-wide.
 * Required steps gate the final step both here and structurally in the DB
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
  existingPlan,
  initial,
  receivesCare = true,
}: {
  profile: { id: string; fullName: string | null };
  /**
   * False means this person came to pay for someone else's care, not to
   * receive care. Being asked to consent to telehealth for themselves, hand
   * over their date of birth and pick their own plan before they could give us
   * money for their mother was the first thing a sponsor hit, and it is a hard
   * stop at the highest-intent moment the product has.
   *
   * When they later choose to join as a patient too, this flips true and they
   * get the full flow below — including the intake questions, which is what
   * the screening calendar and risk scoring are actually built from.
   */
  receivesCare?: boolean;
  /** Server-rendered <YourCareTeam/> passed in — it's an async server component. */
  careTeamSlot: ReactNode;
  /** Set when the caller already has an active/trialing subscription — see
   * onboarding/page.tsx. Skips "choose your plan" entirely in favour of a
   * reconciliation notice, so a returning paying patient is never asked to
   * pick and pay for a plan a second time. */
  existingPlan: { name: string; status: string } | null;
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
  // What the demographics step actually saved this session. `initial` is the
  // server value from page load, so without this a reopened "About you" step
  // would come back blank for anyone who had just filled it in.
  const [demographics, setDemographics] = useState({
    dateOfBirth: initial.dateOfBirth,
    sex: initial.sex,
  });

  const readyForPlan = consentDone && demographicsDone;
  const currentStep = !consentDone ? 0 : !demographicsDone ? 1 : !intakeCollapsed ? 2 : 3;

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

      <OnboardingProgress current={currentStep} />

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
        {/* There are no plans to be on any more (they were retired in favour
            of a free app plus per-piece-of-work doctor time), and the previous
            wording here also contradicted the confirmation screen at the end
            of this same flow. This says the same thing that screen and the
            upgrade prompts say. */}
        <p className="text-sm text-charcoal-ink">
          If a result or symptom meets those criteria, it goes to a doctor for review, and
          you&apos;ll see exactly who reviewed it and when. An abnormal screening result always
          reaches a doctor, and a dangerous reading always gets you the full safety net:
          immediate guidance, your emergency contact told, and a check-in afterwards. None of
          that depends on you paying for anything.
        </p>
        <p className="text-sm text-charcoal-ink">
          The app itself is free. The only thing that costs money is a doctor&apos;s time when
          you ask for it, and that is also what adds a Tarragon doctor being paged on a
          dangerous reading and routine review of your readings when nothing is flagged.
        </p>
      </div>

      {careTeamSlot}

      {/* Step 1: Consent */}
      {consentDone ? (
        <DoneRow label="Your agreement" onReopen={() => setConsentDone(false)} />
      ) : (
        <ConsentStep onComplete={() => setConsentDone(true)} />
      )}

      {/* Step 2: Demographics + location (revealed after consent) */}
      {consentDone &&
        (demographicsDone ? (
          <DoneRow
            label="About you"
            detail={demographics.dateOfBirth ?? undefined}
            onReopen={() => setDemographicsDone(false)}
          />
        ) : (
          <DemographicsForm
            initial={demographics}
            onComplete={(saved) => {
              setDemographics(saved);
              setDemographicsDone(true);
            }}
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

      {/* Step 3: Health profile (skippable) */}
      {readyForPlan && !intakeCollapsed && (
        <IntakeStep patientId={profile.id} onSkip={() => setIntakeCollapsed(true)} />
      )}
      {readyForPlan && intakeCollapsed && (
        <DoneRow label="Health profile" onReopen={() => setIntakeCollapsed(false)} />
      )}

      {/* Step 4: a patient who already has something active (a legacy pack
          still running, or a paid service bought before finishing onboarding)
          sees that instead; everyone else sees the honest intake-driven
          preview, then a plain confirmation that the app is free. There is no
          plan to choose here any more. */}
      {readyForPlan && intakeCollapsed && existingPlan && (
        <ExistingPlanNotice planName={existingPlan.name} status={existingPlan.status} />
      )}
      {readyForPlan && intakeCollapsed && !existingPlan && <PlanPreview patientId={profile.id} />}
      {readyForPlan && intakeCollapsed && !existingPlan && <ReadyNotice />}

      {!readyForPlan && (
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
          decide from their side whether you can follow how they are doing, and they can stop at
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

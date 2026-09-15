"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useMyWeightManagementEnrolment,
  useWeightManagementCheckins,
  useWeightManagementDoseSteps,
  useSubmitWeightCheckin,
} from "@/lib/queries/weight-management";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SEMANTIC_ICON } from "@/lib/icons";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Supervised Weight Management, patient side.
 *
 * The disclosure at the top is not marketing softening and must not be
 * trimmed. Tarragon supervises people taking medication they obtained
 * themselves; it does not prescribe or supply it, and the database refuses an
 * enrolment against a medication Tarragon started. Someone spending several
 * hundred thousand naira a month on the drug is entitled to know exactly which
 * part of that Tarragon is responsible for.
 *
 * Nothing here decides eligibility, and nothing here agrees a dose. Both are a
 * doctor's, enforced by RLS: a patient cannot mark themselves eligible, and the
 * dose-step write policy requires prescribing authority. A planned step with no
 * `agreed_by` is shown as planned, never as an instruction — the same
 * null-gating rule as ReviewedByDoctor everywhere else on this platform.
 */

const SYMPTOMS = [
  { key: "nausea", label: "Nausea" },
  { key: "vomiting", label: "Vomiting" },
  { key: "diarrhoea", label: "Diarrhoea" },
  { key: "constipation", label: "Constipation" },
  { key: "abdominalPain", label: "Stomach pain" },
] as const;

const SEVERITY = ["None", "Mild", "Moderate", "Severe"] as const;

type SymptomKey = (typeof SYMPTOMS)[number]["key"];

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatPatientDate(date, { day: "numeric", month: "short", year: "numeric" });
}

export function WeightManagementPanel({
  organisationId,
  patientId,
}: {
  organisationId: string;
  patientId: string;
}) {
  const { data: enrolment, isLoading } = useMyWeightManagementEnrolment(patientId);
  const { data: checkins } = useWeightManagementCheckins(enrolment?.id ?? null);
  const { data: doseSteps } = useWeightManagementDoseSteps(enrolment?.id ?? null);
  const submit = useSubmitWeightCheckin();

  const [scores, setScores] = useState<Record<SymptomKey, number>>({
    nausea: 0,
    vomiting: 0,
    diarrhoea: 0,
    constipation: 0,
    abdominalPain: 0,
  });
  const [weight, setWeight] = useState("");
  const [poorOralIntake, setPoorOralIntake] = useState(false);
  const [redFlag, setRedFlag] = useState(false);
  const [note, setNote] = useState("");

  if (isLoading) return null;

  if (!enrolment) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SEMANTIC_ICON.weight className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
            Losing weight on medication?
          </CardTitle>
          <CardDescription>
            If you are taking weight-loss medication, or thinking about it, a doctor can supervise
            how it is used: whether it is right for you, at what dose, and what to do when something
            changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-lg bg-soft-sage/40 p-3 text-xs leading-relaxed text-charcoal-ink/75 dark:text-night-ink/75">
            Tarragon does not prescribe, sell or supply weight-loss medication, and is not a
            pharmacy. You obtain your own prescription and your own medicine. What you would be
            paying for is a doctor taking responsibility for how it is used.
          </p>
          <Button asChild size="sm">
            <Link href="/patient/subscription">See Supervised Weight Management</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const awaitingEligibility = enrolment.status === "pending_eligibility";
  const latest = checkins?.[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.weight className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Supervised Weight Management
        </CardTitle>
        <CardDescription>
          {awaitingEligibility
            ? "A doctor is reviewing whether this is right for you. Nothing starts until they have."
            : `Supervised until ${shortDate(enrolment.ends_at) ?? "the end of your term"}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {awaitingEligibility ? (
          <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Your doctor needs a recorded assessment and your own prescription details before
            supervision can start. They will be in touch. If the honest answer turns out to be that
            this is not right for you, they will tell you that instead.
          </p>
        ) : null}

        {doseSteps && doseSteps.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/55 dark:text-night-ink/55">
              Your dose plan
            </p>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {doseSteps.map((step) => (
                <li key={step.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-charcoal-ink dark:text-night-ink">{step.dose_label}</p>
                    <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">
                      From {shortDate(step.planned_from)}
                    </p>
                  </div>
                  {/* Null-gated: a step nobody has agreed is a plan, not an
                      instruction, and must never read as one. */}
                  {step.agreed_by ? (
                    <Badge variant={step.reached_at ? "green" : "grey"}>
                      {step.reached_at ? "Reached" : "Agreed with your doctor"}
                    </Badge>
                  ) : (
                    <Badge variant="grey">Planned, not yet agreed</Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!awaitingEligibility ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/55 dark:text-night-ink/55">
                How are you tolerating it?
              </p>
              <p className="mt-0.5 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                {latest
                  ? `Last check-in ${shortDate(latest.checked_in_at)}. ${latest.reviewed_at ? "A clinician has read it." : "Not yet read by a clinician."}`
                  : "Every two weeks is about right."}
              </p>
            </div>

            <div className="space-y-2">
              {SYMPTOMS.map((symptom) => (
                <div key={symptom.key} className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm">{symptom.label}</Label>
                  <div className="flex gap-1">
                    {SEVERITY.map((label, score) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setScores((prev) => ({ ...prev, [symptom.key]: score }))}
                        className={`rounded-full px-2.5 py-1 text-xs transition ${
                          scores[symptom.key] === score
                            ? "bg-clinical-navy text-white"
                            : "bg-charcoal-ink/[0.06] text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="wm-weight" className="text-sm">
                  Weight today, in kg (optional)
                </Label>
                <Input
                  id="wm-weight"
                  inputMode="decimal"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  className="h-9 max-w-[10rem]"
                />
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={poorOralIntake}
                  onChange={(event) => setPoorOralIntake(event.target.checked)}
                />
                <span>I am struggling to keep food or fluids down</span>
              </label>

              {/* Asked explicitly rather than inferred from the severity
                  scores, because inferring it would mean deciding on the
                  patient's behalf what counts as severe. */}
              <label className="flex items-start gap-2 rounded-lg bg-red-50/60 p-2 text-sm dark:bg-red-950/20">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={redFlag}
                  onChange={(event) => setRedFlag(event.target.checked)}
                />
                <span>
                  I have severe stomach pain that will not go away, or that goes through to my back
                </span>
              </label>

              <div className="space-y-1">
                <Label htmlFor="wm-note" className="text-sm">
                  Anything else you want your doctor to know
                </Label>
                <Input
                  id="wm-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            <Button
              size="sm"
              disabled={submit.isPending}
              onClick={() =>
                submit.mutate({
                  organisationId,
                  enrolmentId: enrolment.id,
                  patientId,
                  weightKg: weight ? Number(weight) : null,
                  nausea: scores.nausea,
                  vomiting: scores.vomiting,
                  diarrhoea: scores.diarrhoea,
                  constipation: scores.constipation,
                  abdominalPain: scores.abdominalPain,
                  poorOralIntake,
                  redFlagReported: redFlag,
                  patientNote: note || undefined,
                })
              }
            >
              {submit.isPending ? "Sending…" : "Send this check-in"}
            </Button>

            {submit.isError ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {(submit.error as Error).message}
              </p>
            ) : null}
            {submit.isSuccess ? (
              <p className="text-xs text-deep-forest dark:text-brand-green-bright">
                Sent. {redFlag || poorOralIntake
                  ? "Because of what you have told us, someone will come back to you quickly. If it gets worse before then, go to the nearest hospital."
                  : "Your doctor will read it before your next review."}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

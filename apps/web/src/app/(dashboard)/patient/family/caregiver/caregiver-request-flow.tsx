"use client";

import { useState } from "react";
import Link from "next/link";
import {
  createEldercareAccessRequestAction,
  lookupCareAccessCandidateAction,
} from "../care-access-actions";
import {
  ELDERCARE_RELATIONSHIPS,
  eldercareAccessRequestSchema,
  type CareAccessRequestDirection,
} from "@/lib/validation/care-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Stepper, type StepperStep } from "@/components/ui/stepper";

const RELATIONSHIP_LABEL: Record<string, string> = {
  parent: "Parent",
  grandparent: "Grandparent",
  spouse: "Spouse",
  sibling: "Sibling",
  child: "Adult child",
  other: "Other",
};

type Step = "direction" | "details" | "review" | "done";

const STEP_LABEL: Record<Exclude<Step, "done">, string> = {
  direction: "Who's this for",
  details: "Their details",
  review: "Review & send",
};

/**
 * The eldercare "manage" wizard — the step-by-step page the family page
 * links out to, mirroring how HealthierSG frames adding a caregiver as its
 * own guided flow rather than one dense form. Ends by calling
 * createEldercareAccessRequestAction, which only ever creates a pending
 * care_access_requests row — the other party still has to accept before
 * anything actually changes on either record.
 */
export function CaregiverRequestFlow() {
  const [step, setStep] = useState<Step>("direction");
  const [direction, setDirection] = useState<CareAccessRequestDirection | null>(null);
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState<string>("parent");
  const [candidate, setCandidate] = useState<{ id: string; full_name: string | null } | null>(
    null
  );
  const [lookupTried, setLookupTried] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const steps: StepperStep[] = (["direction", "details", "review"] as const).map((key) => ({
    key,
    label: STEP_LABEL[key],
    state:
      step === "done" || stepIndex(step) > stepIndex(key)
        ? "complete"
        : step === key
          ? "current"
          : "upcoming",
  }));

  function stepIndex(s: Step): number {
    return { direction: 0, details: 1, review: 2, done: 3 }[s];
  }

  async function handleLookup() {
    setError(null);
    const parsed = eldercareAccessRequestSchema.shape.phone.safeParse(phone);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid phone number");
      return;
    }
    setIsPending(true);
    setLookupTried(true);
    try {
      const found = await lookupCareAccessCandidateAction(parsed.data);
      setCandidate(found);
      if (found) setStep("review");
    } finally {
      setIsPending(false);
    }
  }

  async function handleSend() {
    if (!direction) return;
    setError(null);
    setIsPending(true);
    try {
      const result = await createEldercareAccessRequestAction({ phone, relationship, direction });
      if ("error" in result) setError(result.error);
      else {
        setDoneMessage(result.message);
        setStep("done");
      }
    } finally {
      setIsPending(false);
    }
  }

  if (step === "done") {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6 text-center">
          <p className="text-sm font-medium text-brand-green">{doneMessage}</p>
          <Button asChild>
            <Link href="/patient/family">Back to your people</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Stepper steps={steps} />

      {step === "direction" && (
        <Card>
          <CardHeader>
            <CardTitle>Who is this for?</CardTitle>
            <CardDescription>
              &quot;Manage&quot; access lets someone book appointments, order labs and
              prescriptions, log doses and vitals, and see everything on the record, not just
              follow it. It only ever starts once the other person accepts, and either side can
              withdraw it at any time. For someone who should only be able to follow your care, not
              act on it, use{" "}
              <Link href="/patient/family" className="text-brand-green underline">
                next of kin
              </Link>{" "}
              instead.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setDirection("i_will_manage");
                setStep("details");
              }}
              className="w-full rounded-lg border border-charcoal-ink/15 p-4 text-left transition-colors hover:border-brand-green/50 hover:bg-brand-green/[0.03]"
            >
              <p className="font-medium text-charcoal-ink">
                I want someone to manage my care for me
              </p>
              <p className="mt-1 text-sm text-charcoal-ink/60">
                For example, a family member helping you with bookings and prescriptions.
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                setDirection("i_will_help");
                setStep("details");
              }}
              className="w-full rounded-lg border border-charcoal-ink/15 p-4 text-left transition-colors hover:border-brand-green/50 hover:bg-brand-green/[0.03]"
            >
              <p className="font-medium text-charcoal-ink">
                I want to help manage someone else&apos;s care
              </p>
              <p className="mt-1 text-sm text-charcoal-ink/60">
                For example, an elderly parent you look after; they&apos;ll need to accept before
                anything changes.
              </p>
            </button>
          </CardContent>
        </Card>
      )}

      {step === "details" && direction && (
        <Card>
          <CardHeader>
            <CardTitle>
              {direction === "i_will_manage" ? "Who will manage your care?" : "Whose care?"}
            </CardTitle>
            <CardDescription>
              They need a Tarragon account of their own already; we&apos;ll look them up by phone
              number.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cg_phone">Their phone number</Label>
                <Input
                  id="cg_phone"
                  placeholder="+2348012345678"
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    setLookupTried(false);
                    setCandidate(null);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg_relationship">Relationship to you</Label>
                <Select
                  id="cg_relationship"
                  value={relationship}
                  onChange={(event) => setRelationship(event.target.value)}
                >
                  {ELDERCARE_RELATIONSHIPS.map((value) => (
                    <option key={value} value={value}>
                      {RELATIONSHIP_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {lookupTried && !candidate && (
              <p className="text-sm text-red-600">
                We couldn&apos;t find a Tarragon account on that number in your organisation. They
                need their own account first.
              </p>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("direction")}>
                Back
              </Button>
              <Button disabled={isPending || !phone} onClick={handleLookup}>
                {isPending ? "Looking up…" : "Look them up"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "review" && direction && candidate && (
        <Card>
          <CardHeader>
            <CardTitle>Review & send</CardTitle>
            <CardDescription>Nothing changes until they accept.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="rounded-md border border-charcoal-ink/10 p-3 text-sm">
              <p className="font-medium text-charcoal-ink">
                {candidate.full_name ?? "This person"}
              </p>
              <p className="text-charcoal-ink/60">
                {RELATIONSHIP_LABEL[relationship] ?? relationship} · {phone}
              </p>
            </div>
            <p className="text-sm text-charcoal-ink">
              {direction === "i_will_manage"
                ? `We'll ask ${candidate.full_name ?? "them"} to accept managing your care. Until they do, nothing changes.`
                : `We'll ask ${candidate.full_name ?? "them"} to accept you managing their care. Until they do, nothing changes.`}
            </p>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("details")}>
                Back
              </Button>
              <Button disabled={isPending} onClick={handleSend}>
                {isPending ? "Sending…" : "Send request"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

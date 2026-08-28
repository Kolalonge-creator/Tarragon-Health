"use client";

import { useState } from "react";
import { useCreateSpecialistReferral } from "@/lib/queries/specialist-referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ReferralUrgency, Tables } from "@tarragon/shared";

type SpecialistType = Tables<"specialist_referrals">["specialist_type"];

const SPECIALIST_TYPE_LABEL: Record<SpecialistType, string> = {
  urologist: "Urology",
  oncologist: "Oncology",
  ob_gyn: "OB/GYN",
  cardiology: "Cardiology",
  endocrinology: "Endocrinology",
  nephrology: "Nephrology",
  ophthalmology: "Ophthalmology",
  dietetics: "Dietetics",
  podiatry: "Podiatry",
  other: "Other",
};

const MIN_CLINICAL_QUESTION_LENGTH = 15;

/**
 * Clinician-initiated referral creation (task spec §11.3/§11.4/§11.6).
 * Confirmed gap before building this: the ONLY existing way a
 * specialist_referrals row was ever created was the automated
 * abnormal-result-handler Edge Function — there was no clinician-facing
 * "refer this patient" button anywhere, even though CLAUDE.md's Clinical
 * Tier Ladder always assumed a doctor could originate one.
 *
 * The clinical question is required (§11.6: "Please review" isn't good
 * enough) — a short min-length nudges toward an actual question rather than
 * a placeholder. Self-arranged, like every referral since 2026-08-03: this
 * creates the referral and its letter; the patient takes it to whichever
 * specialist they choose. No specialist is assigned or ranked here.
 */
export function CreateReferralForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const createReferral = useCreateSpecialistReferral();
  const [specialistType, setSpecialistType] = useState<SpecialistType | "">("");
  const [clinicalQuestion, setClinicalQuestion] = useState("");
  const [urgency, setUrgency] = useState<ReferralUrgency | "">("");
  const [preferredConsultationType, setPreferredConsultationType] = useState<
    "telemedicine" | "in_person" | "either" | ""
  >("");
  const [preferredLocation, setPreferredLocation] = useState("");

  const questionTooShort = clinicalQuestion.trim().length > 0 && clinicalQuestion.trim().length < MIN_CLINICAL_QUESTION_LENGTH;
  const canSubmit = !!specialistType && clinicalQuestion.trim().length >= MIN_CLINICAL_QUESTION_LENGTH;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Refer to a specialist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="specialist-type">Specialty</Label>
          <Select
            id="specialist-type"
            value={specialistType}
            onChange={(e) => setSpecialistType(e.target.value as SpecialistType)}
          >
            <option value="">Select a specialty</option>
            {(Object.keys(SPECIALIST_TYPE_LABEL) as SpecialistType[]).map((type) => (
              <option key={type} value={type}>
                {SPECIALIST_TYPE_LABEL[type]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="clinical-question">Clinical question</Label>
          <Textarea
            id="clinical-question"
            value={clinicalQuestion}
            onChange={(e) => setClinicalQuestion(e.target.value)}
            placeholder="e.g. Please assess persistent uncontrolled hypertension despite current treatment and advise on further management."
          />
          {questionTooShort && (
            <p className="text-xs text-red-600">Say more than a couple of words — what specifically should the specialist assess?</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="referral-urgency">Urgency</Label>
          <Select id="referral-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value as ReferralUrgency)}>
            <option value="">Not set yet</option>
            <option value="routine">Routine, within weeks</option>
            <option value="priority">Priority, within days</option>
            <option value="urgent">Urgent, same day</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="preferred-consultation">Preferred consultation type</Label>
          <Select
            id="preferred-consultation"
            value={preferredConsultationType}
            onChange={(e) => setPreferredConsultationType(e.target.value as "telemedicine" | "in_person" | "either")}
          >
            <option value="">No preference recorded</option>
            <option value="telemedicine">Telemedicine</option>
            <option value="in_person">In person</option>
            <option value="either">Either</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="preferred-location">Preferred location (optional)</Label>
          <Input
            id="preferred-location"
            value={preferredLocation}
            maxLength={200}
            onChange={(e) => setPreferredLocation(e.target.value)}
            placeholder="e.g. Lagos, Ikeja"
          />
        </div>

        {createReferral.isError && (
          <p className="text-sm text-red-600">
            {(createReferral.error as Error).message || "Could not create the referral. Try again."}
          </p>
        )}
        {createReferral.isSuccess && (
          <p className="text-sm text-brand-green">
            Referral created. The patient can download their referral letter and take it to any{" "}
            {specialistType && SPECIALIST_TYPE_LABEL[specialistType].toLowerCase()} specialist they choose.
          </p>
        )}

        <Button
          disabled={!canSubmit || createReferral.isPending}
          onClick={() =>
            specialistType &&
            createReferral.mutate({
              organisationId,
              patientId,
              specialistType,
              clinicalQuestion: clinicalQuestion.trim(),
              urgency: urgency || undefined,
              preferredConsultationType: preferredConsultationType || undefined,
              preferredLocation: preferredLocation.trim() || undefined,
            })
          }
        >
          {createReferral.isPending ? "Creating…" : "Create referral"}
        </Button>
      </CardContent>
    </Card>
  );
}

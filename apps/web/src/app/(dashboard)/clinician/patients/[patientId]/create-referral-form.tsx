"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useCreateReferral } from "@/lib/queries/specialist-referrals";
import { checkReferralAppropriateness } from "@/lib/referrals/appropriateness-check";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ReferralSource, ReferralUrgency, SpecialistType } from "@tarragon/shared";

const SPECIALIST_TYPE_OPTIONS: { value: SpecialistType; label: string }[] = [
  { value: "cardiology", label: "Cardiology" },
  { value: "endocrinology", label: "Endocrinology" },
  { value: "nephrology", label: "Nephrology" },
  { value: "ophthalmology", label: "Ophthalmology" },
  { value: "ob_gyn", label: "OB-GYN" },
  { value: "urologist", label: "Urology" },
  { value: "oncologist", label: "Oncology" },
  { value: "dietetics", label: "Dietetics" },
  { value: "podiatry", label: "Podiatry" },
  { value: "psychiatry", label: "Psychiatry" },
  { value: "psychology", label: "Psychology" },
  { value: "other", label: "Other" },
];

const REFERRAL_SOURCE_OPTIONS: { value: ReferralSource; label: string }[] = [
  { value: "clinician_initiated", label: "Clinician judgment during review" },
  { value: "abnormal_lab_result", label: "Abnormal lab result" },
  { value: "abnormal_imaging_result", label: "Abnormal imaging result" },
  { value: "chronic_care_programme", label: "Chronic-care programme" },
  { value: "emergency_assessment", label: "Emergency / urgent assessment" },
  { value: "specialist_recommendation", label: "Another specialist's recommendation" },
  { value: "hospital_discharge", label: "Hospital discharge" },
  { value: "clinical_rule", label: "Approved clinical rule" },
];

const URGENCY_OPTIONS: { value: ReferralUrgency; label: string }[] = [
  { value: "routine", label: "Routine — within weeks" },
  { value: "priority", label: "Priority — within days" },
  { value: "urgent", label: "Urgent — same day" },
  { value: "emergency", label: "Emergency" },
];

/**
 * How many lab result documents this patient has on file in the last 90
 * days — a lightweight, real proxy for "recent investigations", used only
 * for the advisory appropriateness check (67.7), never to block submission.
 */
function useRecentInvestigationCount(patientId: string) {
  return useQuery({
    queryKey: ["specialist-referrals", "recent-investigation-count", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from("lab_result_documents")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .gte("created_at", since);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!patientId,
  });
}

/**
 * Creates a specialist referral (67.2/67.3/67.4/67.7) — the clinician-facing
 * form that, before this, simply didn't exist anywhere on the platform:
 * every specialist_referrals row up to 2026-08-29 was either DB-trigger- or
 * one-RPC-created (see 20260828000005_consultation_follow_ups.sql), with no
 * general "refer this patient" UI at all.
 *
 * Self-arranged, like every other clinician-originated order on this
 * platform: no specialist is named and no fee is set here — the patient
 * takes the resulting referral letter to whichever specialist suits them
 * (see referral-letter-document.tsx). Save as draft to keep refining before
 * it becomes a live, tracked episode.
 */
export function CreateReferralForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const [specialistType, setSpecialistType] = useState<SpecialistType | "">("");
  const [referralSource, setReferralSource] = useState<ReferralSource>("clinician_initiated");
  const [urgency, setUrgency] = useState<ReferralUrgency | "">("");
  const [referralReason, setReferralReason] = useState("");
  const [requestedService, setRequestedService] = useState("");

  const { data: recentInvestigationCount } = useRecentInvestigationCount(patientId);
  const createReferral = useCreateReferral();

  const flags = useMemo(
    () =>
      checkReferralAppropriateness({
        specialistType,
        referralSource,
        urgency: urgency || null,
        referralReason,
        requestedService,
        recentInvestigationCount: recentInvestigationCount ?? 0,
      }),
    [specialistType, referralSource, urgency, referralReason, requestedService, recentInvestigationCount]
  );

  const canSubmit = specialistType !== "" && !createReferral.isPending;

  function submit(asDraft: boolean) {
    if (specialistType === "") return;
    createReferral.mutate(
      {
        patientId,
        organisationId,
        specialistType,
        referralSource,
        urgency: urgency || null,
        referralReason,
        requestedService,
        appropriatenessFlags: flags,
        asDraft,
      },
      {
        onSuccess: () => {
          setSpecialistType("");
          setReferralSource("clinician_initiated");
          setUrgency("");
          setReferralReason("");
          setRequestedService("");
        },
      }
    );
  }

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
            {SPECIALIST_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="referral-source">Prompted by</Label>
          <Select
            id="referral-source"
            value={referralSource}
            onChange={(e) => setReferralSource(e.target.value as ReferralSource)}
          >
            {REFERRAL_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="referral-urgency">Urgency</Label>
          <Select id="referral-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value as ReferralUrgency)}>
            <option value="">Not set yet</option>
            {URGENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-charcoal-ink/50">
            The patient never sets or upgrades this themselves — it is a clinical decision.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="referral-reason">Clinical question</Label>
          <Textarea
            id="referral-reason"
            value={referralReason}
            onChange={(e) => setReferralReason(e.target.value)}
            placeholder="What, specifically, do you want the specialist to assess — not just the reason for referral."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="requested-service">Requested service</Label>
          <Input
            id="requested-service"
            value={requestedService}
            onChange={(e) => setRequestedService(e.target.value)}
            placeholder="e.g. Echocardiogram + outpatient review"
          />
        </div>

        {flags.length > 0 && (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">Before you submit</p>
            <ul className="list-inside list-disc text-xs text-amber-800">
              {flags.map((f) => (
                <li key={f.code}>{f.message}</li>
              ))}
            </ul>
            <p className="text-xs text-amber-800/70">Advisory only — you decide whether to proceed.</p>
          </div>
        )}

        {createReferral.isError && (
          <p className="text-sm text-red-600">
            {(createReferral.error as Error).message || "Could not create the referral. Try again."}
          </p>
        )}
        {createReferral.isSuccess && (
          <p className="text-sm text-brand-green">
            Referral created. Set a clinical summary and print the referral letter from its detail page.
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" disabled={!canSubmit} onClick={() => submit(true)}>
            {createReferral.isPending ? "Saving…" : "Save as draft"}
          </Button>
          <Button disabled={!canSubmit} onClick={() => submit(false)}>
            {createReferral.isPending ? "Submitting…" : "Submit referral"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

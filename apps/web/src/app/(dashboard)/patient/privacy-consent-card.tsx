"use client";

import { useState } from "react";
import {
  useCurrentConsentVersions,
  usePatientConsents,
  useWithdrawPatientConsent,
  currentConsentStatus,
  type ConsentType,
} from "@/lib/queries/consent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CONSENT_TYPE_LABEL: Record<ConsentType, string> = {
  data_processing: "How we use your health information",
  telehealth: "Telehealth care",
  terms_of_service: "Terms of service",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function WithdrawControl({
  patientId,
  organisationId,
  consentType,
  currentVersionId,
  currentVersion,
}: {
  patientId: string;
  organisationId: string;
  consentType: ConsentType;
  currentVersionId: string;
  currentVersion: string;
}) {
  const withdraw = useWithdrawPatientConsent(patientId, organisationId);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Withdraw
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="text-xs text-red-800">
        This is a required consent — TarragonHealth cannot keep providing this part of your care
        without it. Withdrawing it does not delete your existing record and does not close your
        account automatically; to close your account or ask us to delete your data, contact{" "}
        <a href="mailto:privacy@tarragonhealth.ng" className="underline">
          privacy@tarragonhealth.ng
        </a>
        .
      </p>
      {withdraw.error && (
        <p className="text-xs text-red-700" role="alert">
          {withdraw.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={withdraw.isPending}
          onClick={() =>
            withdraw.mutate(
              { consentType, currentConsentVersionId: currentVersionId, currentVersion },
              { onSuccess: () => setConfirming(false) },
            )
          }
        >
          {withdraw.isPending ? "Withdrawing…" : "Yes, withdraw this consent"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={withdraw.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Spec §31.15 — the patient-facing half of consent governance: what you
 * agreed to, when, which version, and a way to withdraw it
 * (20260829092000_patient_consent_withdrawal.sql). Built as a card on the
 * existing Profile & settings page rather than a new route, matching how
 * EmergencyContactForm/ChangePasswordForm already sit there.
 */
export function PrivacyConsentCard({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: events, isLoading, isError } = usePatientConsents(patientId);
  const { data: currentVersions } = useCurrentConsentVersions();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Privacy & consent</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (isError || !events) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Privacy & consent</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">Could not load your consent history.</p>
        </CardContent>
      </Card>
    );
  }

  const status = currentConsentStatus(events);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy & consent</CardTitle>
        <CardDescription>
          What you have agreed to, when, and which version. You can withdraw a consent at any
          time; a later re-acceptance always overrides an earlier withdrawal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.size === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No consent history on file yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {[...status.entries()].map(([type, event]) => {
              const withdrawn = event.action === "withdrawn";
              const current = currentVersions?.find((v) => v.consent_type === type);
              return (
                <li key={type} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {CONSENT_TYPE_LABEL[type] ?? type}
                    </p>
                    <Badge variant={withdrawn ? "red" : "green"}>
                      {withdrawn ? "Withdrawn" : "In force"}
                    </Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {withdrawn ? "Withdrawn" : "Accepted"} {formatDate(event.accepted_at)} · version{" "}
                    {event.version}
                  </p>
                  {!withdrawn && (
                    <WithdrawControl
                      patientId={patientId}
                      organisationId={organisationId}
                      consentType={type}
                      currentVersionId={event.consent_version_id}
                      currentVersion={event.version}
                    />
                  )}
                  {withdrawn && current && (
                    <p className="text-xs text-charcoal-ink/50">
                      You can accept the current version again from onboarding at any time.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

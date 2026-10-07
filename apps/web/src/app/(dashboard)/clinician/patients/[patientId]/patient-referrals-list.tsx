"use client";

import Link from "next/link";
import { usePatientReferralsWithDrafts } from "@/lib/queries/specialist-referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { REFERRAL_STATUS_BADGE } from "@/lib/worklist/referral-status-badge";
import { URGENCY_BADGE } from "@/lib/worklist/referral-urgency-badge";
import { chaseLabel } from "@/lib/referrals/chase";

/**
 * This patient's own specialist referrals (including drafts), on their
 * record — "Where is this referral now?" (67.17) answered from the one
 * place a clinician is already looking, without a trip to the org-wide
 * worklist. Read through the audited per-patient function (INV-10); a refusal is
 * shown as unavailable, never as "No referrals".
 */
export function PatientReferralsList({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = usePatientReferralsWithDrafts(patientId);
  const referrals = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Referral history</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">
            Referrals are not available to you for this patient, or could not be loaded. This is not the same as no referrals.
          </p>
        )}
        {!isLoading && !isError && referrals.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No referrals for this patient yet.</p>
        )}
        {referrals.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {referrals.map((referral) => {
              const statusBadge = REFERRAL_STATUS_BADGE[referral.status];
              return (
                <li key={referral.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                    {referral.urgency && (
                      <Badge variant={URGENCY_BADGE[referral.urgency].variant}>
                        {URGENCY_BADGE[referral.urgency].label}
                      </Badge>
                    )}
                    {referral.referral_number && (
                      <span className="text-xs text-charcoal-ink/60">{referral.referral_number}</span>
                    )}
                  </div>
                  <p className="text-sm text-charcoal-ink">{referral.specialist_type.replace(/_/g, " ")}</p>
                  {chaseLabel(referral, new Date()) && (
                    <p className="text-xs text-charcoal-ink/60">{chaseLabel(referral, new Date())}</p>
                  )}
                  {referral.status !== "draft" ? (
                    <Link
                      href={`/clinician/referrals/${referral.id}`}
                      className="text-xs text-brand-green hover:underline"
                    >
                      Open referral
                    </Link>
                  ) : (
                    <p className="text-xs text-charcoal-ink/50">
                      Still a draft. Finish it from the Referrals worklist to submit.
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

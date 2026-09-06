"use client";

import Link from "next/link";
import { useOrgSpecialistReferrals } from "@/lib/queries/specialist-referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { REFERRAL_STATUS_BADGE } from "@/lib/worklist/referral-status-badge";
import { URGENCY_BADGE } from "@/lib/worklist/referral-urgency-badge";

/**
 * This patient's own specialist referrals (including drafts), on their
 * record — "Where is this referral now?" (67.17) answered from the one
 * place a clinician is already looking, without a trip to the org-wide
 * worklist. Filters the org query client-side rather than adding a second
 * network round trip; the org list is already small per-org.
 */
export function PatientReferralsList({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useOrgSpecialistReferrals();
  const referrals = data?.filter((r) => r.patient_id === patientId) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Referral history</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load referrals.</p>}
        {!isLoading && referrals.length === 0 && (
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

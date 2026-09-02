"use client";

import Link from "next/link";
import { useWaitlistedReferrals } from "@/lib/queries/specialist-referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Referrals a clinician has waitlisted with a documented interim plan
 * (67.14) while the patient arranges their own specialist visit —
 * self-arranged fulfilment means there is never a Tarragon-side provider
 * pool to poll for availability, so this is a plain worklist of "still
 * needs an active interim plan followed", not a live-matching view. Actual
 * time-based follow-up is handled server-side by
 * private.escalate_stalled_specialist_referrals, not by this page.
 */
export default function WaitlistedReferralsPage() {
  const { data, isLoading, isError } = useWaitlistedReferrals();

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Waitlisted referrals</CardTitle>
        <Link href="/clinician/referrals" className="text-xs text-brand-green hover:underline">
          Back to all referrals
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load waitlisted referrals.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No referrals are currently waitlisted.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((referral) => (
              <li key={referral.id} className="space-y-2 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant="amber">Waitlisted</Badge>
                  <span className="text-xs text-charcoal-ink/60">{referral.referral_number}</span>
                  {referral.waitlisted_at && (
                    <span className="text-xs text-charcoal-ink/40">since {formatDate(referral.waitlisted_at)}</span>
                  )}
                </div>
                <p className="text-sm font-medium text-charcoal-ink">
                  <Link href={`/clinician/patients/${referral.patient_id}`} className="hover:underline">
                    {referral.patient?.full_name ?? "Unknown patient"}
                  </Link>
                  : {referral.specialist_type}
                </p>
                {referral.interim_management_plan && (
                  <p className="text-xs text-charcoal-ink/60">Interim plan: {referral.interim_management_plan}</p>
                )}
                <Link
                  href={`/clinician/referrals/${referral.id}`}
                  className="text-xs text-brand-green hover:underline"
                >
                  Open referral
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { ReferralStatus } from "@tarragon/shared";

const REFERRAL_STATUS_BADGE: Record<ReferralStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Needs specialist assigned" },
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Ready to book" },
  booked: { variant: "blue", label: "Booked" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  declined: { variant: "grey", label: "Declined" },
  waitlisted: { variant: "amber", label: "Waitlisted — no specialist available" },
};

/**
 * Index behind the doctor sidebar "Referrals" link. RLS
 * (private.is_org_staff) scopes the list to the caller's organisation;
 * each row opens the doctor-facing detail (./[referralId]) with the
 * pipeline stepper and clinical summary.
 */
export default async function DoctorReferralsPage() {
  const supabase = await createClient();
  const { data: referrals } = await supabase
    .from("specialist_referrals")
    .select(
      "id, referral_number, status, specialist_type, urgency, created_at, patient:profiles!specialist_referrals_patient_id_fkey(full_name), specialist_provider:specialist_providers!specialist_referrals_specialist_provider_id_fkey(name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Referrals</h1>
        <p className="text-sm text-charcoal-ink/60">
          Specialist referrals across your organisation, newest first.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All referrals{referrals ? ` (${referrals.length})` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {!referrals || referrals.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No referrals yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {referrals.map((referral) => {
                const badge = REFERRAL_STATUS_BADGE[referral.status];
                return (
                  <li key={referral.id}>
                    <Link
                      href={`/doctor/referrals/${referral.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-charcoal-ink/2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-charcoal-ink">
                          {referral.patient?.full_name ?? "Unnamed patient"}
                          {referral.specialist_type ? ` — ${referral.specialist_type}` : ""}
                        </span>
                        <span className="block text-xs text-charcoal-ink/50">
                          {referral.referral_number}
                          {referral.specialist_provider?.name
                            ? ` · ${referral.specialist_provider.name}`
                            : ""}
                        </span>
                      </span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

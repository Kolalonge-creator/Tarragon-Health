import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { koboToNaira, type ReferralStatus } from "@tarragon/shared";
import type { SpecialistReferralWithDetails } from "@/lib/queries/specialist-referrals";
import { ClinicalSummaryPanel } from "./clinical-summary-panel";

const REFERRAL_STATUS_BADGE: Record<ReferralStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Needs specialist assigned" },
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Ready to book" },
  booked: { variant: "blue", label: "Booked" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  declined: { variant: "grey", label: "Declined" },
};

const REFERRAL_SELECT =
  "*, patient:profiles!specialist_referrals_patient_id_fkey(full_name), specialist_provider:specialist_providers!specialist_referrals_specialist_provider_id_fkey(name, consultation_fee_kobo)";

export default async function DoctorReferralDetailPage({
  params,
}: {
  params: Promise<{ referralId: string }>;
}) {
  const { referralId } = await params;
  const supabase = await createClient();

  // RLS (private.is_org_staff) is the real gate here, same as the escalation
  // detail page — a referral outside the caller's org simply doesn't come back.
  const { data: referral } = await supabase
    .from("specialist_referrals")
    .select(REFERRAL_SELECT)
    .eq("id", referralId)
    .maybeSingle();

  if (!referral) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Referral not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            This referral doesn&apos;t exist or isn&apos;t in your organisation.
          </p>
        </CardContent>
      </Card>
    );
  }

  const typedReferral = referral as SpecialistReferralWithDetails;
  const statusBadge = REFERRAL_STATUS_BADGE[typedReferral.status];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {typedReferral.patient?.full_name ?? "Unnamed patient"}
        </h1>
        <p className="text-charcoal-ink/60">
          {typedReferral.specialist_type} · {typedReferral.referral_number}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Referral detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          {typedReferral.referral_reason && (
            <p className="text-sm text-charcoal-ink">{typedReferral.referral_reason}</p>
          )}
          {typedReferral.specialist_provider && (
            <p className="text-xs text-charcoal-ink/60">
              Assigned to {typedReferral.specialist_provider.name} · ₦
              {koboToNaira(typedReferral.referral_fee_kobo ?? 0).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      <ClinicalSummaryPanel referral={typedReferral} />
    </div>
  );
}

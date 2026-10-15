import { createClient } from "@/lib/supabase/server";
import { ROUTINE_CHART_READ_REASON } from "@/lib/clinical/audited-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stepper } from "@/components/ui/stepper";
import { deriveReferralPipelineStages } from "@/lib/referrals/pipeline-stages";
import { signReferralOutcomeDocumentPath } from "@/lib/referrals/outcome-documents";
import { koboToNaira } from "@tarragon/shared";
import type { SpecialistReferralWithDetails } from "@/lib/queries/specialist-referrals";
import { REFERRAL_STATUS_BADGE } from "@/lib/worklist/referral-status-badge";
import { ClinicalSummaryPanel } from "./clinical-summary-panel";
import { AssignSpecialistProviderForm } from "./assign-specialist-provider-form";
import { ReferralFacilityForm } from "./referral-facility-form";

const ASSIGNABLE_STATUSES = ["pending", "waitlisted"] as const;

export default async function ReferralDetailPage({
  params,
}: {
  params: Promise<{ referralId: string }>;
}) {
  const { referralId } = await params;
  const supabase = await createClient();

  // INV-10 / INV-12: the audited read is the gate. A referral the caller may not see (not tied, not the creator, not the assigned
  // specialist, not the referral desk) and an unknown id look the same, and the refusal is audited.
  const { data: referralPayload } = await supabase.rpc("get_referral_audited", {
    p_referral: referralId,
    p_reason: ROUTINE_CHART_READ_REASON,
  });
  const referral =
    (referralPayload as { status?: string; referral?: unknown } | null)?.status === "ok"
      ? (referralPayload as { referral: unknown }).referral
      : null;

  if (!referral) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Referral not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            This referral doesn&apos;t exist or isn&apos;t available to you.
          </p>
        </CardContent>
      </Card>
    );
  }

  const typedReferral = referral as SpecialistReferralWithDetails;
  const statusBadge = REFERRAL_STATUS_BADGE[typedReferral.status];
  // Authorised here (this select already went through is_org_staff RLS) —
  // the signed URL itself is minted with the service-role client since org
  // staff have no direct storage-object read policy on this bucket.
  const outcomeDocumentUrl = typedReferral.outcome_document_path
    ? await signReferralOutcomeDocumentPath(typedReferral.outcome_document_path)
    : null;

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
          <Stepper steps={deriveReferralPipelineStages(typedReferral)} />
          {typedReferral.referral_reason && (
            <p className="text-sm text-charcoal-ink">{typedReferral.referral_reason}</p>
          )}
          {typedReferral.specialist_provider && (
            <p className="text-xs text-charcoal-ink/60">
              Assigned to {typedReferral.specialist_provider.name} · ₦
              {koboToNaira(typedReferral.referral_fee_kobo ?? 0).toLocaleString()}
            </p>
          )}
          <ReferralFacilityForm
            referralId={typedReferral.id}
            currentFacilityId={(typedReferral as unknown as { facility_id?: string | null }).facility_id ?? null}
            currentFreeText={(typedReferral as unknown as { facility_name_text?: string | null }).facility_name_text ?? null}
            signed={Boolean((typedReferral as unknown as { signed_at?: string | null }).signed_at)}
          />
          {!typedReferral.specialist_provider &&
            ASSIGNABLE_STATUSES.includes(
              typedReferral.status as (typeof ASSIGNABLE_STATUSES)[number]
            ) && (
              <AssignSpecialistProviderForm
                referralId={typedReferral.id}
                specialistType={typedReferral.specialist_type}
              />
            )}
        </CardContent>
      </Card>

      <ClinicalSummaryPanel referral={typedReferral} outcomeDocumentUrl={outcomeDocumentUrl} />
    </div>
  );
}

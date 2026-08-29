import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Stepper } from "@/components/ui/stepper";
import { deriveReferralPipelineStages } from "@/lib/referrals/pipeline-stages";
import { koboToNaira, type ReferralStatus } from "@tarragon/shared";
import type { SpecialistReferralWithDetails } from "@/lib/queries/specialist-referrals";
import { ClinicalSummaryPanel } from "./clinical-summary-panel";
import { SpecialistReportSection } from "./specialist-report-panel";
import { ActionItemsSection } from "./action-items-panel";

const REFERRAL_STATUS_BADGE: Record<ReferralStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Needs specialist assigned" },
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Ready to book" },
  booked: { variant: "blue", label: "Booked" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  declined: { variant: "grey", label: "Declined" },
  waitlisted: { variant: "amber", label: "Waitlisted, no specialist available" },
};

const REFERRAL_SELECT =
  "*, patient:profiles!specialist_referrals_patient_id_fkey(full_name), specialist_provider:specialist_providers!specialist_referrals_specialist_provider_id_fkey(name, consultation_fee_kobo)";

export default async function ReferralDetailPage({
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

  // Spec §70.9 — multi-specialist coordination: flag when this patient has
  // other concurrent, unresolved referrals so nobody reads this one in
  // isolation. Filtering/reporting only, not the guardrailed matching engine.
  const ACTIVE_STATUSES: ReferralStatus[] = [
    "pending_payment",
    "payment_confirmed",
    "pending",
    "waitlisted",
    "booked",
    "confirmed",
  ];
  const { data: concurrent } = await supabase
    .from("specialist_referrals")
    .select("id, specialist_type")
    .eq("patient_id", typedReferral.patient_id)
    .neq("id", typedReferral.id)
    .in("status", ACTIVE_STATUSES);

  // Spec §70.8 — specialist continuity: this patient's previously filed
  // specialist consultations, across every referral. Org-staff only —
  // specialists have no platform login, so there is no external party this
  // could leak to yet.
  const { data: pastConsultations } = await supabase
    .from("specialist_consultation_extractions")
    .select("referral_id, diagnosis, report_date, confirmed_at, specialist_referrals(referral_number, specialist_type)")
    .eq("patient_id", typedReferral.patient_id)
    .eq("status", "confirmed")
    .neq("referral_id", typedReferral.id)
    .order("confirmed_at", { ascending: false })
    .limit(10);

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

      {concurrent && concurrent.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          This patient also has an active referral to{" "}
          {concurrent.map((c) => c.specialist_type.replace(/_/g, " ")).join(", ")}. Consider whether
          these need coordinating (shared medications, overlapping tests, one visit covering both).
        </div>
      )}

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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specialist report</CardTitle>
        </CardHeader>
        <CardContent>
          <SpecialistReportSection referralId={typedReferral.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Action items</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionItemsSection referralId={typedReferral.id} />
        </CardContent>
      </Card>

      <ClinicalSummaryPanel referral={typedReferral} />

      {pastConsultations && pastConsultations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>This patient&apos;s specialist history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10">
              {pastConsultations.map((row) => {
                const ref = row.specialist_referrals as {
                  referral_number?: string;
                  specialist_type?: string;
                } | null;
                return (
                  <li key={row.referral_id} className="space-y-0.5 py-2 text-sm">
                    <p className="font-medium text-charcoal-ink">
                      {ref?.specialist_type?.replace(/_/g, " ") ?? "specialist"} · {ref?.referral_number}
                    </p>
                    <p className="text-charcoal-ink/70">{row.diagnosis ?? "No diagnosis on file"}</p>
                    <p className="text-xs text-charcoal-ink/50">
                      {row.report_date ? new Date(row.report_date).toLocaleDateString("en-GB") : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

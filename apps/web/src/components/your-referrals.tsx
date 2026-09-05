import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stepper } from "@/components/ui/stepper";
import { EmptyHint } from "@/components/ui/empty-hint";
import { deriveReferralPipelineStages } from "@/lib/referrals/pipeline-stages";
import { ReferralOutcomeDocumentUpload } from "@/components/referral-outcome-document-upload";
import type { ReferralStatus } from "@tarragon/shared";

import { formatPatientDate } from "@/lib/format-date";
// Patient-facing status copy — deliberately not the staff worklist labels
// (REFERRAL_STATUS_BADGE in clinician/referrals/page.tsx), per CLAUDE.md's
// brand voice rule: no clinical jargon, no fear-based urgency.
const PATIENT_STATUS_COPY: Record<ReferralStatus, string> = {
  // Never actually shown — the query below excludes drafts (they aren't a
  // live episode yet), but Record<ReferralStatus, ...> still needs every
  // key so a future status can't silently fall through unhandled.
  draft: "Not yet submitted",
  pending: "Your care team is arranging this",
  pending_payment: "Ready to book (payment needed)",
  payment_confirmed: "Payment received, booking your appointment",
  booked: "Appointment booked",
  confirmed: "Confirmed",
  completed: "Visit complete",
  closed: "Closed: your care plan has been updated",
  declined: "Cancelled",
  waitlisted: "Your care team is finding the right specialist for you",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

/**
 * Patient's own specialist referrals — closes the dangling end of the
 * abnormal-result pipeline (AbnormalResultHandler creates the row; until
 * this component, nothing ever showed it to the patient). Renders nothing
 * if the patient has no referrals on record, unless the caller passes
 * `emptyHint` — Health summary heads this section itself and needs the
 * heading answered rather than left bare.
 */
export async function YourReferrals({
  patientId,
  emptyHint,
}: {
  patientId: string;
  emptyHint?: string;
}) {
  const supabase = await createClient();

  const { data: referrals } = await supabase
    .from("specialist_referrals")
    .select(
      "id, referral_number, specialist_type, status, urgency, referral_fee_kobo, payable_kobo, appointment_date, booking_confirmed_at, specialist_provider_id, treatment_plan_received_at, shared_care_handback_at, outcome_document_path, closed_at, care_plan_update_note, created_at, specialist_provider:specialist_providers!specialist_referrals_specialist_provider_id_fkey(name)",
    )
    .eq("patient_id", patientId)
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  if (!referrals || referrals.length === 0) {
    return emptyHint ? <EmptyHint>{emptyHint}</EmptyHint> : null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Specialist referrals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {referrals.map((referral) => (
          <div
            key={referral.id}
            className="space-y-1 border-b border-charcoal-ink/10 dark:border-night-ink/15 pb-4 last:border-0 last:pb-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-charcoal-ink dark:text-night-ink">{referral.specialist_type}</p>
              <p className="shrink-0 text-xs text-charcoal-ink/50 dark:text-night-ink/55">{formatDate(referral.created_at)}</p>
            </div>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{PATIENT_STATUS_COPY[referral.status]}</p>
            <Stepper steps={deriveReferralPipelineStages(referral)} />
            {referral.appointment_date && (
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                Appointment: {formatPatientDate(referral.appointment_date)}
              </p>
            )}
            {/* The letter is the referral. Tarragon does not book the
                specialist or take a fee on one, so there is nobody to choose
                here and nothing to pay us; the patient takes this to whichever
                clinic suits them. Never gated by plan. */}
            <a
              href={`/api/patient/referral/${referral.id}/letter`}
              className="inline-block text-xs font-medium text-brand-green dark:text-brand-green-bright hover:underline"
            >
              Download your referral letter
            </a>
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
              Take this to any {referral.specialist_type.replace(/_/g, " ")} you like. It tells them
              why you were referred and what we have already done, so you do not have to explain it
              yourself. You pay that clinic directly.
            </p>
            {referral.status === "closed" ? (
              referral.care_plan_update_note && (
                <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                  What changed: {referral.care_plan_update_note}
                </p>
              )
            ) : referral.outcome_document_path ? (
              <p className="text-xs text-brand-green dark:text-brand-green-bright">
                We have what the specialist gave you. Your care team will update your plan.
              </p>
            ) : (
              <ReferralOutcomeDocumentUpload referralId={referral.id} />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

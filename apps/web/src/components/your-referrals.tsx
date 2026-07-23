import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stepper } from "@/components/ui/stepper";
import { deriveReferralPipelineStages } from "@/lib/referrals/pipeline-stages";
import type { ReferralStatus } from "@tarragon/shared";
import { PayForReferralButton } from "./pay-for-referral-button";
import { PayWithWalletButton } from "@/components/pay-with-wallet-button";

// Patient-facing status copy — deliberately not the staff worklist labels
// (REFERRAL_STATUS_BADGE in clinician/referrals/page.tsx), per CLAUDE.md's
// brand voice rule: no clinical jargon, no fear-based urgency.
const PATIENT_STATUS_COPY: Record<ReferralStatus, string> = {
  pending: "Your care team is arranging this",
  pending_payment: "Ready to book — payment needed",
  payment_confirmed: "Payment received — booking your appointment",
  booked: "Appointment booked",
  confirmed: "Confirmed",
  completed: "Visit complete",
  declined: "Cancelled",
  waitlisted: "Your care team is finding the right specialist for you",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Patient's own specialist referrals — closes the dangling end of the
 * abnormal-result pipeline (AbnormalResultHandler creates the row; until
 * this component, nothing ever showed it to the patient). Renders nothing
 * if the patient has no referrals on record.
 */
export async function YourReferrals({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const { data: referrals } = await supabase
    .from("specialist_referrals")
    .select(
      "id, referral_number, specialist_type, status, urgency, referral_fee_kobo, appointment_date, booking_confirmed_at, specialist_provider_id, treatment_plan_received_at, shared_care_handback_at, created_at, specialist_provider:specialist_providers!specialist_referrals_specialist_provider_id_fkey(name)",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!referrals || referrals.length === 0) {
    return null;
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
            className="space-y-1 border-b border-charcoal-ink/10 pb-4 last:border-0 last:pb-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-charcoal-ink">{referral.specialist_type}</p>
              <p className="shrink-0 text-xs text-charcoal-ink/50">{formatDate(referral.created_at)}</p>
            </div>
            <p className="text-xs text-charcoal-ink/60">{PATIENT_STATUS_COPY[referral.status]}</p>
            <Stepper steps={deriveReferralPipelineStages(referral)} />
            {referral.specialist_provider && (
              <p className="text-xs text-charcoal-ink/60">With {referral.specialist_provider.name}</p>
            )}
            {referral.appointment_date && (
              <p className="text-xs text-charcoal-ink/60">
                Appointment: {new Date(referral.appointment_date).toLocaleDateString()}
              </p>
            )}
            {referral.status === "pending_payment" && referral.referral_fee_kobo && (
              <>
                <PayForReferralButton
                  referralId={referral.id}
                  feeKobo={referral.referral_fee_kobo}
                />
                <PayWithWalletButton
                  orderType="referral"
                  orderId={referral.id}
                  amountKobo={referral.referral_fee_kobo}
                  patientId={patientId}
                />
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

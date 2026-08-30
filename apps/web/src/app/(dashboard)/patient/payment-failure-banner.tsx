import { createClient } from "@/lib/supabase/server";
import { RetryPaymentButton } from "@/app/(dashboard)/patient/retry-payment-button";
import { EscalatePaymentIssueButton } from "@/app/(dashboard)/patient/escalate-payment-issue-button";
import { NAV_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

/**
 * §91.10 patient-facing payment-failure recovery. Both webhooks already
 * correctly detect a failed charge and flip subscriptions.status='past_due'
 * (supabase/functions/paystack-webhook, stripe-webhook) — this is pure
 * surfacing of that already-authoritative signal, no new schema. Renders
 * above the fold on the patient Overview, next to NextBestAction, since an
 * unpaid plan is a more urgent thing to see than a wellness nudge.
 */
export async function PaymentFailureBanner({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, amount_minor, currency, plan:subscription_plans(name)")
    .eq("subscriber_id", patientId)
    .eq("status", "past_due")
    .maybeSingle();

  if (!subscription) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <NAV_ICON.warning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div>
          <p className="font-medium text-charcoal-ink">
            We couldn&apos;t collect your last payment for {subscription.plan?.name ?? "your plan"}
          </p>
          <p className="text-sm text-charcoal-ink/70">
            {koboToNaira(subscription.amount_minor).toLocaleString()} {subscription.currency} is
            outstanding. Retry with the same or a different card to keep your plan active.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <RetryPaymentButton subscriptionId={subscription.id} />
        <EscalatePaymentIssueButton subscriptionId={subscription.id} />
      </div>
    </div>
  );
}

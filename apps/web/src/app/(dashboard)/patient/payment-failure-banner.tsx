import { createClient } from "@/lib/supabase/server";
import { RetryPaymentButton } from "@/app/(dashboard)/patient/retry-payment-button";
import { EscalatePaymentIssueButton } from "@/app/(dashboard)/patient/escalate-payment-issue-button";
import { NAV_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

/**
 * §91.10 patient-facing payment-failure recovery.
 *
 * Rewired 2026-09-02 for the 2026-08-31 pay-per-service cutover — the
 * original design read subscriptions.status='past_due', an authoritative
 * flag the recurring-billing webhooks set on a declined renewal charge.
 * service_purchases (which replaced subscriptions/subscription_plans) has no
 * equivalent status: a one-off purchase is either 'pending_payment' (never
 * paid) or 'active' (paid) — there is no third "we tried to charge you and
 * it failed" state, because there is no recurring charge to fail. What IS
 * still true and useful to surface is a purchase the patient started and
 * never finished — the checkout session was abandoned, declined, or the
 * patient just never returned to it — which leaves service_purchases stuck
 * at 'pending_payment' indefinitely (record_service_purchase_intent always
 * inserts a fresh row; nothing else here mutates or expires it). A 30-minute
 * grace period avoids nagging someone mid-checkout who simply hasn't reached
 * the provider's hosted page yet.
 */
/** Data + date work lives outside the component body (react-hooks/purity),
 * same pattern as next-best-action.tsx's resolveNextAction. */
async function findStalePendingPurchase(patientId: string) {
  const supabase = await createClient();
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("service_purchases")
    .select("id, payable_kobo, currency, created_at, service_product:service_products(code, name)")
    .eq("patient_id", patientId)
    .eq("status", "pending_payment")
    .lt("created_at", staleBefore)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function PaymentFailureBanner({ patientId }: { patientId: string }) {
  const purchase = await findStalePendingPurchase(patientId);

  if (!purchase || !purchase.service_product?.code) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-4">
      <div className="flex items-start gap-3">
        <NAV_ICON.warning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
        <div>
          <p className="font-medium text-charcoal-ink dark:text-night-ink">
            You started buying {purchase.service_product.name ?? "a service"} but didn&apos;t finish
          </p>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {koboToNaira(purchase.payable_kobo ?? 0).toLocaleString()} {purchase.currency} is still
            unpaid. Pick up where you left off with the same or a different card.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <RetryPaymentButton serviceProductCode={purchase.service_product.code} />
        <EscalatePaymentIssueButton servicePurchaseId={purchase.id} />
      </div>
    </div>
  );
}

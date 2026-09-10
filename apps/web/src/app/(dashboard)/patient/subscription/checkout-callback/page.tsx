import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { verifyTransactionDetail } from "@/lib/paystack/transactions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  fromMinorUnits,
  CURRENCY_SYMBOL,
  type Currency,
} from "@tarragon/shared";

function formatAmount(amountMinor: number, currency: string): string {
  const cur = (["NGN", "GBP", "USD"] as const).includes(currency as Currency)
    ? (currency as Currency)
    : "NGN";
  return `${CURRENCY_SYMBOL[cur]}${fromMinorUnits(amountMinor, cur).toLocaleString()}`;
}

/**
 * `callback_url` for service-purchase checkouts initiated from
 * /patient/subscription (see actions.ts). Non-authoritative UX-only role:
 * paystack-webhook is what actually activates the row; this page only does
 * a same-request confirmation check.
 *
 * NGN via Paystack only. This used to also handle a Stripe `session_id`
 * (diaspora/GBP-USD checkouts); removed 2026-09-03 along with the rest of
 * the Stripe integration — there was never a registered Stripe account
 * behind it, so no checkout could ever have actually produced one.
 */
export default async function SubscriptionCheckoutCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const params = await searchParams;
  const reference = params.reference ?? params.trxref;

  let succeeded = false;
  let amountMinor: number | null = null;
  let feeMinor: number | null = null;
  let currency: string | null = null;
  if (reference) {
    const result = await verifyTransactionDetail(reference);
    succeeded = result.ok && result.data.status === "success";
    if (result.ok) {
      amountMinor = result.data.amountMinor;
      feeMinor = result.data.feeMinor;
      currency = result.data.currency;
    }
  }
  // Paystack's fee-bearer setting on this account passes its own
  // transaction fee to the customer, so the amount it actually charged
  // (already shown, and confirmed, on Paystack's own checkout page before
  // this page ever loads) can be higher than the price the patient saw in
  // the app. Shown here from the real charge, never a guess — Paystack only
  // reveals its fee once the charge completes.
  const hasFee =
    succeeded &&
    feeMinor !== null &&
    feeMinor > 0 &&
    amountMinor !== null &&
    currency;

  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] dark:bg-night-ink/10 px-4 py-16">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card p-6 shadow-sm dark:shadow-none">
        <PageHeader
          title={succeeded ? "Payment received" : "Checkout finished"}
          icon={SEMANTIC_ICON.billing}
          description={
            succeeded
              ? "We're activating this now; it usually takes a few seconds."
              : "We're confirming your payment. If it succeeded, this will activate automatically within a minute or two."
          }
        />
        {hasFee && (
          <div className="rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-3 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            <p>
              {formatAmount(amountMinor! - feeMinor!, currency!)} for the
              service + {formatAmount(feeMinor!, currency!)} card processing fee
              ={" "}
              <span className="font-medium text-charcoal-ink dark:text-night-ink">
                {formatAmount(amountMinor!, currency!)} charged
              </span>
            </p>
          </div>
        )}
        <Button asChild className="w-full">
          <Link href="/patient/subscription">Back to my services</Link>
        </Button>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { verifyTransaction } from "@/lib/paystack/transactions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";

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
  if (reference) {
    const result = await verifyTransaction(reference);
    succeeded = result.ok && result.data.status === "success";
  }

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
        <Button asChild className="w-full">
          <Link href="/patient/subscription">Back to my services</Link>
        </Button>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { verifyTransaction } from "@/lib/paystack/transactions";
import { Button } from "@/components/ui/button";

/**
 * Paystack's `callback_url` for plan-change / add-on-attach checkouts
 * initiated from /patient/subscription (see actions.ts). Same non-
 * authoritative UX-only role as onboarding/checkout-callback — the
 * paystack-webhook Edge Function is what actually activates the row.
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
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 text-center shadow-sm">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">
          {succeeded ? "Payment received" : "Checkout finished"}
        </h1>
        <p className="text-sm text-charcoal-ink/70">
          {succeeded
            ? "We're activating this now — it usually takes a few seconds."
            : "We're confirming your payment. If it succeeded, this will activate automatically within a minute or two."}
        </p>
        <Button asChild className="w-full">
          <Link href="/patient/subscription">Back to my subscription</Link>
        </Button>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { verifyTransaction } from "@/lib/paystack/transactions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * `callback_url` for a guest checkout purchase (see /checkout/continue).
 * Same non-authoritative UX-only role as /patient/subscription/
 * checkout-callback — paystack-webhook + private.apply_service_purchase_
 * payment is what actually activates the row; this only confirms same-
 * request and welcomes someone who, unlike every other purchaser landing on
 * that page, has never seen the dashboard before.
 */
export default async function GuestCheckoutReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
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
      <div className="w-full max-w-md space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
        <PageHeader
          title={succeeded ? "Payment received" : "Checkout finished"}
          icon={SEMANTIC_ICON.billing}
          description={
            succeeded
              ? "We're activating this now; it usually takes a few seconds. Your account is set up and you're signed in."
              : "We're confirming your payment. If it succeeded, this will activate automatically within a minute or two. Your account is set up and you're signed in."
          }
        />
        <Button asChild className="w-full">
          <Link href="/patient">Go to my dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

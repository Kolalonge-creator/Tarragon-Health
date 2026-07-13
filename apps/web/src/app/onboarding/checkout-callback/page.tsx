import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { verifyTransaction } from "@/lib/paystack/transactions";
import { verifyCheckoutSession } from "@/lib/stripe/checkout";
import { Button } from "@/components/ui/button";

/**
 * `callback_url`/`success_url` after hosted checkout, for either provider.
 * This page NEVER activates a subscription itself — verifyTransaction()/
 * verifyCheckoutSession() here are same-request UX checks only ("looks like
 * it went through"), so a patient can't spoof activation by hitting this URL
 * with a fabricated reference/session_id. paystack-webhook's charge.success
 * / stripe-webhook's checkout.session.completed handlers are the sole
 * source of truth and may land a few seconds after this page renders.
 */
export default async function CheckoutCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string; session_id?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const params = await searchParams;
  const reference = params.reference ?? params.trxref;

  let succeeded = false;
  let attempted = false;
  if (params.session_id) {
    attempted = true;
    const result = await verifyCheckoutSession(params.session_id);
    succeeded = result.ok && result.data.paymentStatus === "paid";
  } else if (reference) {
    attempted = true;
    const result = await verifyTransaction(reference);
    succeeded = result.ok && result.data.status === "success";
  }

  // The patient made a plan choice and went through checkout — onboarding
  // is complete either way, even if payment is still settling or failed;
  // /patient shows the subscription's real status (trialing/past_due/etc.)
  // rather than trapping them in a loop back to plan selection.
  if (!profile.onboarding_completed_at) {
    const supabase = await createClient();
    await supabase
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", profile.id);
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 text-center shadow-sm">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">
          {succeeded ? "Payment received" : attempted ? "Payment pending" : "Checkout finished"}
        </h1>
        <p className="text-sm text-charcoal-ink/70">
          {succeeded
            ? "We're activating your plan now — this usually takes a few seconds."
            : "We're confirming your payment. If it succeeded, your plan will activate automatically within a minute or two."}
        </p>
        <Button asChild className="w-full">
          <Link href="/patient">Go to my dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

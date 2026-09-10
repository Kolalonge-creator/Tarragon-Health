import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { isGuestCheckoutProductCode } from "@/lib/billing/guest-checkout-products";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Where the sign-in link sent by startGuestCheckout (lib/billing/
 * guest-checkout.ts) lands, via /auth/callback's `?redirect=` passthrough —
 * a session now exists (established by /auth/callback the normal way,
 * exchangeCodeForSession, same as any other magic-link sign-in), so this is
 * the first point at which the actual purchase can be recorded.
 *
 * Reuses purchaseServiceProduct() exactly as every logged-in purchase does —
 * nothing about checkout, activation or RLS is guest-specific past this
 * point.
 */
export default async function GuestCheckoutContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  const user = await getCurrentUser();
  if (!user) {
    const redirectTo = code ? `/checkout/continue?code=${encodeURIComponent(code)}` : "/checkout/continue";
    redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);
  }

  if (!code || !isGuestCheckoutProductCode(code)) {
    return (
      <ContinueError message="We couldn't tell which service you meant to buy. Please start again." />
    );
  }

  const result = await purchaseServiceProduct({
    serviceProductCode: code,
    callbackPath: "/checkout/receipt",
  });

  if (result?.checkoutUrl) {
    redirect(result.checkoutUrl);
  }
  if (result?.activated) {
    redirect("/checkout/receipt");
  }

  return <ContinueError message={result?.error ?? "We couldn't start checkout just then."} retryCode={code} />;
}

function ContinueError({ message, retryCode }: { message: string; retryCode?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
        <PageHeader title="Could not continue" icon={SEMANTIC_ICON.billing} description={message} />
        {retryCode ? (
          <Button asChild className="w-full">
            <Link href={`/checkout/${retryCode}`}>Try again</Link>
          </Button>
        ) : (
          <Button asChild className="w-full">
            <Link href="/pricing">Back to pricing</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

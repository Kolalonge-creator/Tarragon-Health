import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";
import {
  isGuestCheckoutProductCode,
  guestCheckoutProductCopy,
} from "@/lib/billing/guest-checkout-products";
import { fetchServicePriceOverrides } from "@/lib/marketing/plan-prices";
import { servicePrice } from "@/app/(marketing)/_content/pricing";
import { GuestCheckoutForm } from "./guest-checkout-form";

export const metadata: Metadata = {
  title: "Buy a service — Tarragon Health",
  robots: { index: false, follow: false },
};

/**
 * Public, no-login product page — buy any guest-eligible paid service by
 * email, no account created in advance. Deliberately sits outside both
 * (marketing) (which must not write to Supabase / touch auth — see
 * CLAUDE.md's marketing-boundary rule) and (dashboard) (which hard-redirects
 * an unauthenticated visitor to /login before this page could ever render) —
 * same reasoning /login and /signup already sit at the top level rather
 * than under either route group.
 */
export default async function GuestCheckoutPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!isGuestCheckoutProductCode(code)) {
    notFound();
  }

  const copy = guestCheckoutProductCopy(code);
  if (!copy) {
    notFound();
  }

  const overrides = await fetchServicePriceOverrides();
  const price = servicePrice(code, overrides) || copy.staticPrice;

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-4 py-12 sm:py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <GuardLeafMark className="h-11 w-11" />
          <p className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">
            Tarragon<span className="text-brand-green">Health</span>
          </p>
        </div>

        <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="font-heading text-xl font-semibold text-charcoal-ink">{copy.name}</h1>
            <p className="font-heading text-2xl font-bold text-deep-forest">
              {price}
              {copy.priceCaption ? (
                <span className="ml-1 text-sm font-normal text-charcoal-ink/60">
                  {copy.priceCaption}
                </span>
              ) : null}
            </p>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/75">{copy.description}</p>
        </div>

        <GuestCheckoutForm code={code} />

        <p className="text-center text-sm text-charcoal-ink/60">
          Already have an account?{" "}
          <Link
            href={`/login?redirect=${encodeURIComponent(`/checkout/continue?code=${code}`)}`}
            className="font-medium text-brand-green hover:underline"
          >
            Sign in instead
          </Link>
        </p>
      </div>
    </div>
  );
}

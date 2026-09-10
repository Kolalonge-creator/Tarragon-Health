import Link from "next/link";
import {
  guestCheckoutProductCopy,
  type GuestCheckoutProductCode,
} from "@/lib/billing/guest-checkout-products";
import { servicePrice, type ResolvedServicePrices } from "../_content/pricing";

/**
 * A single priced product, surfaced as the "next step" after a free tool's
 * result — the BMI/activity calculators and the symptom checker. Reuses the
 * exact same copy and live-price resolution the pricing page uses
 * (servicePrice/ResolvedServicePrices), so a visitor never sees a number
 * here that checkout would then contradict.
 *
 * `href` is deliberately a prop, not derived from `code` — today it points
 * at the relevant marketing product page (e.g. /weight-management), which is
 * live; once guest checkout (buy without an account first) ships, callers
 * can repoint it at `/checkout/${code}` without this component changing.
 */
export function ProductCtaCard({
  code,
  href,
  ctaLabel = "See how it works",
  overrides,
  className = "",
}: {
  code: GuestCheckoutProductCode;
  href: string;
  ctaLabel?: string;
  overrides?: ResolvedServicePrices;
  className?: string;
}) {
  const copy = guestCheckoutProductCopy(code);
  if (!copy) return null;

  const price = servicePrice(code, overrides) || copy.staticPrice;

  return (
    <div
      className={`rounded-2xl border-2 border-brand-green/30 bg-soft-sage p-6 ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{copy.name}</h3>
        <p className="font-heading text-xl font-bold text-deep-forest">
          {price}
          {copy.priceCaption ? (
            <span className="ml-1 text-sm font-normal text-charcoal-ink/60">
              {copy.priceCaption}
            </span>
          ) : null}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">{copy.description}</p>
      <Link
        href={href}
        className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-brand-green px-5 text-sm font-medium text-white transition-colors hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

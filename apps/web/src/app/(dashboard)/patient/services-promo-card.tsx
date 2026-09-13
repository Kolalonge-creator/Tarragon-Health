"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useMyServicePurchases, isPurchaseCurrentlyActive } from "@/lib/queries/service-purchases";
import { useActiveServiceProducts } from "@/lib/queries/service-products";
import { buyServiceProduct } from "@/app/(dashboard)/patient/subscription/actions";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

const MAX_FEATURED = 3;

function formatPrice(priceKobo: number, currency: Currency): string {
  if (priceKobo === 0) return "Free";
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(priceKobo, currency).toLocaleString()}`;
}

/**
 * Overview-page entry point into /patient/subscription ("My services") — the
 * pay-per-service catalogue where every doctor-time purchase actually
 * happens. Added 2026-09-11: the catalogue itself was already fully built
 * (22 live service_products, real Paystack checkout), but the only way in
 * was drilling into "Your account" in the sidebar, four rows past
 * "Emergency card" — for a founder-employed doctor team whose paid time is
 * the platform's real revenue line, that is a business problem, not just a
 * UX nit. This card puts the catalogue's cheapest currently-buyable items
 * directly in front of every patient on the page they land on most.
 *
 * Deliberately not styled as an urgent banner (brand guide: no fear-based
 * urgency) — it reads as an offer, not a bill. Self-hides once nothing is
 * left to buy, same self-hiding convention as the other conditional cards
 * on this page, rather than showing an empty "Buy a service" shell.
 */
export function ServicesPromoCard() {
  const { data: purchases, isLoading: purchasesLoading } = useMyServicePurchases();
  const { data: catalogue, isLoading: catalogueLoading } = useActiveServiceProducts();
  const [buyState, buyAction, buyPending] = useActionState(buyServiceProduct, undefined);

  if (purchasesLoading || catalogueLoading) return null;

  const active = (purchases ?? []).filter(isPurchaseCurrentlyActive);
  const activeProductIds = new Set(active.map((p) => p.service_product_id));
  // NGN only, same carve-out as the catalogue page itself — USD/GBP rows
  // exist for the diaspora sponsor-checkout flow, never for a patient
  // buying their own access.
  const buyable = (catalogue ?? []).filter(
    (product) => product.currency === "NGN" && !activeProductIds.has(product.id),
  );

  if (buyable.length === 0) return null;

  const featured = buyable.slice(0, MAX_FEATURED);
  const remaining = buyable.length - featured.length;

  return (
    <Card className="border-brand-green/25 bg-soft-sage/30 dark:border-brand-green-bright/25 dark:bg-brand-green/10">
      <CardHeader>
        <div className="flex items-center gap-2">
          <SEMANTIC_ICON.billing className="h-4.5 w-4.5 text-deep-forest dark:text-brand-green-bright" aria-hidden />
          <CardTitle>Doctor time, when you need it</CardTitle>
        </div>
        <CardDescription>
          The app is free to use. You only ever pay for a doctor&apos;s time — one service at a
          time, nothing auto-renews.
          {active.length > 0
            ? ` You already have ${active.length} active.`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {buyState?.error && <p className="text-sm text-red-600 dark:text-red-400">{buyState.error}</p>}
        {buyState?.message && (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{buyState.message}</p>
        )}
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {featured.map((product) => (
            <li key={product.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{product.name}</p>
              </div>
              <form action={buyAction} className="shrink-0">
                <input type="hidden" name="serviceProductCode" value={product.code} />
                <Button type="submit" size="sm" variant="outline" disabled={buyPending}>
                  {product.price_kobo === 0 ? "Switch to" : "Buy"}{" "}
                  {formatPrice(product.price_kobo, product.currency as Currency)}
                </Button>
              </form>
            </li>
          ))}
        </ul>
        <Link
          href="/patient/subscription"
          className="inline-block text-sm font-medium text-brand-green hover:underline dark:text-brand-green-bright"
        >
          {remaining > 0 ? `See all ${buyable.length} services` : "See all services"} →
        </Link>
      </CardContent>
    </Card>
  );
}

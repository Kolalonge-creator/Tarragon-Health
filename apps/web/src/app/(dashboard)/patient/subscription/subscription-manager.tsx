"use client";

import { useActionState, useEffect, useState } from "react";
import {
  useMyServicePurchases,
  isPurchaseCurrentlyActive,
} from "@/lib/queries/service-purchases";
import {
  useActiveServiceProducts,
  type ServiceProduct,
} from "@/lib/queries/service-products";
import { buyServiceProduct } from "./actions";
import {
  fromMinorUnits,
  CURRENCY_SYMBOL,
  type Currency,
} from "@tarragon/shared";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";
import { PaystackFeeNotice } from "@/components/billing/paystack-fee-notice";

function formatPrice(priceKobo: number, currency: Currency): string {
  if (priceKobo === 0) return "Free";
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(priceKobo, currency).toLocaleString()}`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatPatientDate(d, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * How the buyable catalogue is grouped.
 *
 * Added 2026-09-10, when the catalogue went from eight products to twenty-two
 * and a flat wall of buttons stopped being readable. Grouping is by what the
 * patient is actually deciding between -- cover that runs for a term, a single
 * piece of a doctor's time, or a signed document -- not by price or by table.
 *
 * The order is deliberate: cover first, because it is the cheapest way in and
 * the only thing that keeps someone watched between visits.
 *
 * Anything that matches no group falls into "Other" rather than disappearing.
 * A product silently missing from a billing page is how this platform
 * previously advertised three diaspora packs nobody could buy.
 */
const PRODUCT_GROUPS: {
  id: string;
  title: string;
  blurb: string;
  match: (code: string) => boolean;
}[] = [
  {
    id: "cover",
    title: "Ongoing cover",
    blurb:
      "Paid once for a fixed term, then it stops. No card is kept on file and there is nothing to cancel.",
    match: (code) =>
      code.startsWith("continuous_monitoring_") ||
      code.startsWith("weight_management_"),
  },
  {
    id: "doctor-time",
    title: "A doctor's time",
    blurb: "One piece of work, priced on its own. Buy it when you need it.",
    match: (code) =>
      code.endsWith("_credit") || code === "written_result_interpretation",
  },
  {
    id: "documents",
    title: "Doctor-signed documents",
    blurb:
      "Issued as a signed PDF anyone can verify. Not valid as a pre-employment or immigration medical, which need a physical examination.",
    match: (code) => code.startsWith("verified_document_"),
  },
  {
    id: "other",
    title: "Other",
    blurb: "",
    match: () => true,
  },
];

/**
 * Pay-per-service patient billing page (2026-08-31, replaced the recurring
 * subscription/add-on manager). There is no "current plan" any more —
 * has_feature_access unions features across every currently active
 * service_purchases row, so a patient can simultaneously hold several (e.g.
 * essential_pack + lifestyle-coaching_pack). There is also no cancel/resume
 * concept: a purchase is a one-off charge for a fixed window and simply
 * expires — buying again is the only "renewal" there is.
 */
export function SubscriptionManager() {
  const {
    data: purchases,
    isLoading,
    isError,
    refetch: refetchPurchases,
  } = useMyServicePurchases();
  const { data: catalogue } = useActiveServiceProducts();
  const [buyState, buyAction, buyPending] = useActionState(
    buyServiceProduct,
    undefined,
  );
  const [promoCode, setPromoCode] = useState("");

  useEffect(() => {
    if (buyState?.message) {
      refetchPurchases();
    }
  }, [buyState, refetchPurchases]);

  if (isLoading)
    return (
      <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
        Loading…
      </p>
    );
  if (isError)
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Could not load your services.
      </p>
    );

  const active = (purchases ?? []).filter(isPurchaseCurrentlyActive);
  const activeProductIds = new Set(active.map((p) => p.service_product_id));
  // NGN only — USD/GBP service_products (e.g. lifestyle-coaching_usd_pack)
  // exist for the diaspora sponsor-checkout flow (sponsor-bill-checkout.ts),
  // never for a patient buying their own access. See
  // docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md's "diaspora is a sponsor, not a
  // patient" decision — there is no diaspora patient-facing tier.
  const buyable = (catalogue ?? []).filter(
    (product) =>
      product.currency === "NGN" && !activeProductIds.has(product.id),
  );

  // First matching group wins, and "Other" matches everything, so nothing can
  // fall out of the list. Empty groups are dropped rather than shown as
  // headings with nothing under them.
  const grouped = PRODUCT_GROUPS.map((group) => ({
    group,
    products: buyable.filter(
      (product) =>
        PRODUCT_GROUPS.find((candidate) => candidate.match(product.code))
          ?.id === group.id,
    ),
  })).filter(({ products }) => products.length > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Your active services</CardTitle>
            <CardDescription>
              Each is a one-off purchase covering a fixed window: nothing renews
              automatically, and payments aren&apos;t refundable. Buy again any
              time to extend.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {active.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
                Nothing active yet. The app itself is free; you only ever pay
                for a doctor&apos;s time. Buy a service when you want one.
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {active.map((purchase) => {
                  const endLabel = formatDate(purchase.expires_at);
                  return (
                    <li
                      key={purchase.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                          {purchase.service_product?.name ?? "Unknown service"}
                        </p>
                        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                          {endLabel
                            ? `Active until ${endLabel}`
                            : "Active, no expiry"}
                        </p>
                      </div>
                      <Badge variant="green">Active</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Buy a service</CardTitle>
            <CardDescription>One-off payment, no auto-renewal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {buyable.length > 0 && <PaystackFeeNotice />}
            {buyState?.error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {buyState.error}
              </p>
            )}
            {buyState?.message && (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                {buyState.message}
              </p>
            )}
            {buyable.length > 0 && (
              <div className="space-y-1">
                <Label
                  htmlFor="promo-code"
                  className="text-xs text-charcoal-ink/60 dark:text-night-ink/60"
                >
                  Promo code (optional)
                </Label>
                <Input
                  id="promo-code"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  placeholder="e.g. WELCOME10"
                  className="h-9 max-w-xs"
                  autoCapitalize="characters"
                />
              </div>
            )}
            {buyable.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
                You already have everything currently on offer.
              </p>
            ) : (
              <div className="space-y-5">
                {grouped.map(({ group, products }) => (
                  <div key={group.id} className="space-y-2">
                    <div>
                      <p className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
                        {group.title}
                      </p>
                      {group.blurb ? (
                        <p className="text-xs leading-relaxed text-charcoal-ink/60 dark:text-night-ink/60">
                          {group.blurb}
                        </p>
                      ) : null}
                    </div>
                    <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                      {products.map((product: ServiceProduct) => (
                        <li
                          key={product.id}
                          className="flex flex-wrap items-start justify-between gap-3 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                              {product.name}
                            </p>
                            {product.description ? (
                              <p className="mt-0.5 text-xs leading-relaxed text-charcoal-ink/60 dark:text-night-ink/60">
                                {product.description}
                              </p>
                            ) : null}
                          </div>
                          <form action={buyAction} className="shrink-0">
                            <input
                              type="hidden"
                              name="serviceProductCode"
                              value={product.code}
                            />
                            <input
                              type="hidden"
                              name="promoCode"
                              value={promoCode}
                            />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              disabled={buyPending}
                            >
                              {product.price_kobo === 0 ? "Switch to" : "Buy"}{" "}
                              {formatPrice(
                                product.price_kobo,
                                product.currency as Currency,
                              )}
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(purchases ?? []).some((p) => !isPurchaseCurrentlyActive(p)) && (
        <Card>
          <CardHeader>
            <CardTitle>Past services</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {(purchases ?? [])
                .filter((p) => !isPurchaseCurrentlyActive(p))
                .map((purchase) => (
                  <li
                    key={purchase.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                      {purchase.service_product?.name ?? "Unknown service"}
                    </p>
                    <Badge variant="grey">
                      {purchase.status === "pending_payment"
                        ? "Payment pending"
                        : purchase.status}
                    </Badge>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

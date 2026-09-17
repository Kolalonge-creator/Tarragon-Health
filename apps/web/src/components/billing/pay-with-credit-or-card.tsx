"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PaystackFeeNotice } from "@/components/billing/paystack-fee-notice";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import {
  useMyPlatformCreditBalance,
  usePayServicePurchaseWithCredit,
} from "@/lib/queries/platform-credit";
import { useActiveServiceProducts } from "@/lib/queries/service-products";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

/**
 * The shared "how do you want to pay for this credit" decision, extracted
 * from `patient/subscription/buy-service-dialog.tsx` (the first place this
 * shape shipped, 2026-09-17) so the five other pay-per-service screens that
 * sell a one-off `service_products` credit (second opinion, senior case
 * review, verified documents, ask-a-doctor, confidential messages) don't
 * each reimplement the same balance/shortfall arithmetic.
 *
 * Unlike BuyServiceDialog this isn't a modal — every call site here already
 * has its own inline "buy a credit" upsell block, so this renders as plain
 * inline controls that drop into that block. It still never removes the
 * existing card-payment path (`purchaseServiceProduct` → Paystack checkout):
 * platform credit is additive, offered first when there's enough balance,
 * with card payment always available as a fallback.
 *
 * `onSuccess` fires once money has actually moved with nothing left to wait
 * on — a successful credit spend, or a card purchase that turned out to be
 * free/fully-covered and so never left this page. It does NOT fire when the
 * card path redirects to Paystack checkout (the point of that redirect is
 * that payment finishes on a different page); callers that need to react to
 * that too should treat the checkout redirect itself as their signal (the
 * page is navigating away regardless).
 */
export function PayWithCreditOrCard({
  patientId,
  serviceProductCode,
  callbackPath,
  buyLabel = "Buy a credit",
  creditLabel = "Pay with platform credit",
  onError,
  onSuccess,
}: {
  patientId: string;
  serviceProductCode: string;
  callbackPath: string;
  buyLabel?: string;
  creditLabel?: string;
  onError: (message: string) => void;
  onSuccess?: () => void;
}) {
  const { data: products } = useActiveServiceProducts();
  const product = products?.find((p) => p.code === serviceProductCode);
  const { data: balance } = useMyPlatformCreditBalance(patientId);
  const payWithCredit = usePayServicePurchaseWithCredit();
  const [isBuyingByCard, setIsBuyingByCard] = useState(false);

  const priceKobo = product?.price_kobo ?? null;
  const currency = (product?.currency ?? "NGN") as Currency;
  const balanceKobo = balance?.balance_kobo ?? 0;
  const hasEnoughCredit = priceKobo !== null && (priceKobo === 0 || balanceKobo >= priceKobo);
  const shortfallKobo = priceKobo !== null ? Math.max(0, priceKobo - balanceKobo) : 0;
  // Only rendered once the product has actually loaded (priceKobo !== null),
  // so `currency` is always the real product currency by the time either
  // paragraph below reads it — the "NGN" above is just a type-safe default
  // for the brief window before useActiveServiceProducts resolves.
  const showBalanceInfo = priceKobo !== null && priceKobo > 0;

  function payByCredit() {
    payWithCredit.mutate(
      { patientId, serviceProductCode },
      {
        onSuccess: (data) => {
          if (data.ok) {
            onSuccess?.();
            return;
          }
          if (data.reason === "insufficient_balance") {
            onError(
              `You need ₦${(data.shortfall_kobo / 100).toLocaleString()} more platform credit for this — pay by card instead, or top up first.`,
            );
            return;
          }
          onError("This can no longer be paid for — refresh and try again.");
        },
        onError: (err) => onError((err as Error)?.message ?? "Could not pay with platform credit."),
      },
    );
  }

  async function buyByCard() {
    setIsBuyingByCard(true);
    try {
      const result = await purchaseServiceProduct({ serviceProductCode, callbackPath });
      if (result?.error) {
        onError(result.error);
        return;
      }
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      // No checkout URL and no error means record_service_purchase_intent
      // activated this for free (a fully promo/voucher-covered or zero-price
      // product) — nothing left to pay for.
      onSuccess?.();
    } finally {
      setIsBuyingByCard(false);
    }
  }

  return (
    <div className="space-y-2">
      {showBalanceInfo && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Your platform credit: {CURRENCY_SYMBOL[currency]}
          {fromMinorUnits(balanceKobo, currency).toLocaleString()}
          {!hasEnoughCredit &&
            ` — you need ${CURRENCY_SYMBOL[currency]}${fromMinorUnits(shortfallKobo, currency).toLocaleString()} more`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {hasEnoughCredit && (
          <Button size="sm" disabled={payWithCredit.isPending} onClick={payByCredit}>
            {payWithCredit.isPending ? "Paying…" : creditLabel}
          </Button>
        )}
        <Button
          size="sm"
          variant={hasEnoughCredit ? "outline" : "default"}
          disabled={isBuyingByCard}
          onClick={buyByCard}
        >
          {isBuyingByCard ? "Redirecting to payment…" : buyLabel}
        </Button>
      </div>
      {showBalanceInfo && !hasEnoughCredit && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          <Link href="/patient/care#platform-credit" className="underline">
            Add funds to your platform credit
          </Link>{" "}
          and come back, or pay by card now.
        </p>
      )}
      <PaystackFeeNotice />
    </div>
  );
}

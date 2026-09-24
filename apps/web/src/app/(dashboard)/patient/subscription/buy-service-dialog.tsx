"use client";

import { useState } from "react";
import Link from "next/link";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  useMyPlatformCreditBalance,
  usePayServicePurchaseWithCredit,
  type PayWithCreditResult,
} from "@/lib/queries/platform-credit";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import type { ServiceProduct } from "@/lib/queries/service-products";

function formatPrice(priceKobo: number, currency: Currency): string {
  if (priceKobo === 0) return "Free";
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(priceKobo, currency).toLocaleString()}`;
}

/**
 * The "cost shown up front, deducted from your balance" confirmation the
 * founder asked for (2026-09-17): clicking a product opens this instead of
 * immediately charging anything. With enough platform credit, confirming
 * pays for it right there — no Paystack redirect at all. Short on balance,
 * it says exactly how much more is needed and links to the top-up card
 * rather than offering a button that would just fail server-side.
 *
 * Falls back to the existing card-payment form (paystackFormAction, the same
 * buyAction the page already had) when the patient would rather not use
 * credit — this dialog is an additional path, not a replacement for paying
 * by card each time.
 */
export function BuyServiceDialog({
  patientId,
  product,
  paystackFormAction,
  promoCode,
  trigger,
}: {
  patientId: string;
  product: ServiceProduct;
  paystackFormAction: (formData: FormData) => void;
  promoCode: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data: balance } = useMyPlatformCreditBalance(patientId);
  const payWithCredit = usePayServicePurchaseWithCredit();
  const [result, setResult] = useState<PayWithCreditResult | null>(null);

  const balanceKobo = balance?.balance_kobo ?? 0;
  const priceKobo = product.price_kobo;
  const hasEnoughCredit = priceKobo === 0 || balanceKobo >= priceKobo;
  const shortfallKobo = Math.max(0, priceKobo - balanceKobo);

  function close() {
    setOpen(false);
    payWithCredit.reset();
    setResult(null);
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <ConfirmDialog
        open={open}
        title={product.name}
        description={hasEnoughCredit ? "Pay for this from your platform credit balance." : undefined}
        confirmLabel={
          payWithCredit.isPending ? "Paying…" : hasEnoughCredit ? "Pay with credit" : "Top up first"
        }
        confirmDisabled={payWithCredit.isPending || (!hasEnoughCredit && priceKobo > 0)}
        cancelLabel="Close"
        onCancel={close}
        onConfirm={() => {
          if (!hasEnoughCredit) return;
          payWithCredit.mutate(
            { patientId, serviceProductCode: product.code },
            {
              onSuccess: (data) => {
                setResult(data);
                if (data.ok) {
                  setTimeout(close, 1200);
                }
              },
            },
          );
        }}
      >
        <ConfirmDialogFacts
          rows={[
            { label: "Cost", value: formatPrice(priceKobo, product.currency as Currency) },
            { label: "Your platform credit", value: `₦${(balanceKobo / 100).toLocaleString()}` },
            hasEnoughCredit
              ? { label: "Balance after", value: `₦${((balanceKobo - priceKobo) / 100).toLocaleString()}` }
              : { label: "You need", value: `₦${(shortfallKobo / 100).toLocaleString()} more` },
          ]}
        />

        {!hasEnoughCredit && (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Your balance is too low for this.{" "}
            <Link
              href="/patient/care#platform-credit"
              className="underline"
              onClick={close}
            >
              Add funds to your platform credit
            </Link>{" "}
            and come back, or pay by card below instead.
          </p>
        )}

        {result && !result.ok && (
          <p className="text-xs text-red-600 dark:text-red-300">
            {result.reason === "insufficient_balance"
              ? `You need ₦${(result.shortfall_kobo / 100).toLocaleString()} more.`
              : "This purchase can no longer be paid for — refresh and try again."}
          </p>
        )}
        {result && result.ok && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">Paid. This is active now.</p>
        )}
        {payWithCredit.isError && (
          <p className="text-xs text-red-600 dark:text-red-300">
            {(payWithCredit.error as Error)?.message ?? "Could not complete this purchase."}
          </p>
        )}

        <form
          action={(formData) => {
            close();
            paystackFormAction(formData);
          }}
        >
          <input type="hidden" name="serviceProductCode" value={product.code} />
          <input type="hidden" name="promoCode" value={promoCode} />
          <Button type="submit" size="sm" variant="outline">
            Pay by card instead
          </Button>
        </form>

        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">
          Covered by our 30-day money-back guarantee on your first purchase.
        </p>
      </ConfirmDialog>
    </>
  );
}

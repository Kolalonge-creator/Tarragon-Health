"use client";

import { useRef, useState } from "react";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import type { ServiceProduct } from "@/lib/queries/service-products";

function formatPrice(priceKobo: number, currency: Currency): string {
  if (priceKobo === 0) return "Free";
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(priceKobo, currency).toLocaleString()}`;
}

/**
 * The "cost shown up front" confirmation: clicking a product opens this
 * instead of immediately charging anything. Confirming submits the page's
 * card-payment form (paystackFormAction, the page's buyAction), which takes
 * the patient to Paystack checkout. Card is the only way to pay.
 */
export function BuyServiceDialog({
  product,
  paystackFormAction,
  promoCode,
  trigger,
}: {
  product: ServiceProduct;
  paystackFormAction: (formData: FormData) => void;
  promoCode: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function close() {
    setOpen(false);
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <ConfirmDialog
        open={open}
        title={product.name}
        confirmLabel={product.price_kobo === 0 ? "Get this" : "Pay by card"}
        cancelLabel="Close"
        onCancel={close}
        onConfirm={() => formRef.current?.requestSubmit()}
      >
        <ConfirmDialogFacts
          rows={[{ label: "Cost", value: formatPrice(product.price_kobo, product.currency as Currency) }]}
        />

        <form
          ref={formRef}
          action={(formData) => {
            close();
            paystackFormAction(formData);
          }}
        >
          <input type="hidden" name="serviceProductCode" value={product.code} />
          <input type="hidden" name="promoCode" value={promoCode} />
        </form>

        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">
          Covered by our 30-day money-back guarantee on your first purchase.
        </p>
      </ConfirmDialog>
    </>
  );
}

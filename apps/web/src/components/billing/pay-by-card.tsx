"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PaystackFeeNotice } from "@/components/billing/paystack-fee-notice";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";

/**
 * The shared "buy a one-off credit by card" control for the pay-per-service
 * screens (second opinion, ask-a-doctor, and similar). Payment is always a
 * Paystack card checkout via `purchaseServiceProduct`.
 *
 * `onSuccess` fires only when the purchase turned out to be free or fully
 * covered (a promo or voucher), so it never left this page. It does NOT fire
 * when the card path redirects to Paystack checkout; the page is navigating
 * away in that case.
 */
export function PayByCard({
  serviceProductCode,
  callbackPath,
  buyLabel = "Buy a credit",
  onError,
  onSuccess,
}: {
  serviceProductCode: string;
  callbackPath: string;
  buyLabel?: string;
  onError: (message: string) => void;
  onSuccess?: () => void;
}) {
  const [isBuyingByCard, setIsBuyingByCard] = useState(false);

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
      // product), so there is nothing left to pay for.
      onSuccess?.();
    } finally {
      setIsBuyingByCard(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isBuyingByCard} onClick={buyByCard}>
          {isBuyingByCard ? "Redirecting to payment…" : buyLabel}
        </Button>
      </div>
      <PaystackFeeNotice />
    </div>
  );
}

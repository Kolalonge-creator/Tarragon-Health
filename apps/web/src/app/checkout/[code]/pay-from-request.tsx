"use client";

import { useRef, useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { checkoutErrorKey, isCoveredReply } from "@/lib/commerce/model";
import { CheckoutError, useStartCheckout } from "@/lib/queries/commerce";

/** Starts paying from a payment request link. Only the link's code and a retry key are sent: the item, the person and the price are the database's. */
export function PayFromRequest({ code }: { code: string }) {
  const start = useStartCheckout();
  const clientKey = useRef<string | null>(null);
  const [error, setError] = useState<ReturnType<typeof checkoutErrorKey> | null>(null);

  async function pay() {
    setError(null);
    clientKey.current ??= crypto.randomUUID();
    try {
      const r = await start.mutateAsync({ code: "payment_request", paymentRequest: code, clientKey: clientKey.current });
      if (isCoveredReply(r)) return; // a supporter's order is never sponsor-covered; nothing to open
      window.location.assign(r.checkout_url);
    } catch (e) {
      if (e instanceof CheckoutError && e.code !== "unknown" && e.code !== "payment_unavailable") clientKey.current = null;
      setError(checkoutErrorKey(e instanceof CheckoutError ? e.code : "unknown"));
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" className="min-h-11 w-full" onClick={pay} disabled={start.isPending}>
        {start.isPending ? t("request.page.paying", "en") : t("request.page.pay", "en")}
      </Button>
      <FormError id="pay-request-error" message={error ? t(error, "en") : null} />
    </div>
  );
}

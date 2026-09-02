"use client";

import { useActionState } from "react";
import { buyServiceProduct } from "@/app/(dashboard)/patient/subscription/actions";
import { Button } from "@/components/ui/button";

/**
 * Retrying a stuck service_purchases checkout is literally the same
 * operation as buying it in the first place — record_service_purchase_intent
 * always opens a fresh pending row, so this reuses buyServiceProduct
 * unchanged rather than a bespoke "resume this checkout" action.
 */
export function RetryPaymentButton({ serviceProductCode }: { serviceProductCode: string }) {
  const [state, formAction, pending] = useActionState(buyServiceProduct, undefined);

  return (
    <form action={formAction}>
      <input type="hidden" name="serviceProductCode" value={serviceProductCode} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Redirecting…" : "Retry payment"}
      </Button>
      {state?.error && <p className="pt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

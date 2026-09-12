"use client";

import { useActionState } from "react";
import { cancelPendingServicePurchaseAction } from "@/app/(dashboard)/patient/payment-failure-banner-actions";
import { Button } from "@/components/ui/button";

export function DismissPendingPurchaseButton({ servicePurchaseId }: { servicePurchaseId: string }) {
  const [state, formAction, pending] = useActionState(cancelPendingServicePurchaseAction, undefined);

  return (
    <form action={formAction}>
      <input type="hidden" name="servicePurchaseId" value={servicePurchaseId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? "Closing…" : "Not right now"}
      </Button>
      {state?.error && <p className="pt-1 text-xs text-red-600 dark:text-red-300">{state.error}</p>}
    </form>
  );
}

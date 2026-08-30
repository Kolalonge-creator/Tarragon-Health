"use client";

import { useActionState } from "react";
import { retryFailedPayment } from "@/app/(dashboard)/patient/subscription/actions";
import { Button } from "@/components/ui/button";

export function RetryPaymentButton({ subscriptionId }: { subscriptionId: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => retryFailedPayment(formData.get("subscriptionId") as string),
    undefined,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Redirecting…" : "Retry payment"}
      </Button>
      {state?.error && <p className="pt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

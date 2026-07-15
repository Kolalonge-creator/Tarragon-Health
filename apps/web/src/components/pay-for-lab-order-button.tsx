"use client";

import { useActionState } from "react";
import { payForLabOrder } from "@/app/(dashboard)/patient/lab-tests/actions";
import { Button } from "@/components/ui/button";
import { koboToNaira } from "@tarragon/shared";

export function PayForLabOrderButton({ orderId, amountKobo }: { orderId: string; amountKobo: number }) {
  const [state, formAction, pending] = useActionState(payForLabOrder, undefined);

  return (
    <form action={formAction} className="pt-1">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Redirecting…" : `Pay ₦${koboToNaira(amountKobo).toLocaleString()} to confirm`}
      </Button>
      {state?.error && <p className="pt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

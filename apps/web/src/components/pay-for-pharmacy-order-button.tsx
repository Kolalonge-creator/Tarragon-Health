"use client";

import { useActionState } from "react";
import { payForPharmacyOrder } from "@/app/(dashboard)/patient/pharmacy/actions";
import { Button } from "@/components/ui/button";
import { koboToNaira } from "@tarragon/shared";

export function PayForPharmacyOrderButton({ orderId, amountKobo }: { orderId: string; amountKobo: number }) {
  const [state, formAction, pending] = useActionState(payForPharmacyOrder, undefined);

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

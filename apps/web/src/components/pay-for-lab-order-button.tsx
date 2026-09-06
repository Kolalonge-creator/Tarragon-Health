"use client";

import { useActionState } from "react";
import { payForLabOrder } from "@/app/(dashboard)/patient/lab-tests/actions";
import { PromoCodeField } from "@/components/promo-code-field";
import { PriceBreakdownConfirm } from "@/components/billing/price-breakdown-confirm";
import { orderBreakdown } from "@/lib/billing/price-breakdown";
import { koboToNaira } from "@tarragon/shared";

export function PayForLabOrderButton({
  orderId,
  amountKobo,
  totalKobo,
}: {
  orderId: string;
  amountKobo: number;
  /** The pre-discount catalogue price, if known — lets the confirm step show
   * an itemized breakdown instead of just the final number. Falls back to
   * amountKobo (no discount line) when a call site doesn't have it. */
  totalKobo?: number;
}) {
  const [state, formAction, pending] = useActionState(payForLabOrder, undefined);
  const breakdown = orderBreakdown({
    label: "Lab tests",
    totalKobo: totalKobo ?? amountKobo,
    payableKobo: amountKobo,
  });

  return (
    <div className="space-y-1">
      <form action={formAction} className="pt-1">
        <input type="hidden" name="orderId" value={orderId} />
        <PriceBreakdownConfirm
          breakdown={breakdown}
          triggerLabel={`Pay ₦${koboToNaira(amountKobo).toLocaleString()} to confirm`}
          pending={pending}
        />
        {state?.error && <p className="pt-1 text-xs text-red-600 dark:text-red-300">{state.error}</p>}
      </form>
      <PromoCodeField orderId={orderId} orderType="lab" />
    </div>
  );
}

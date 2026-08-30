"use client";

import { useActionState } from "react";
import { payForReferral } from "@/app/(dashboard)/patient/referrals/actions";
import { PromoCodeField } from "@/components/promo-code-field";
import { PriceBreakdownConfirm } from "@/components/billing/price-breakdown-confirm";
import { orderBreakdown } from "@/lib/billing/price-breakdown";
import { koboToNaira } from "@tarragon/shared";

export function PayForReferralButton({
  referralId,
  feeKobo,
  totalKobo,
}: {
  referralId: string;
  feeKobo: number;
  /** The pre-discount catalogue price, if known — see PayForLabOrderButton. */
  totalKobo?: number;
}) {
  const [state, formAction, pending] = useActionState(payForReferral, undefined);
  const breakdown = orderBreakdown({
    label: "Specialist referral",
    totalKobo: totalKobo ?? feeKobo,
    payableKobo: feeKobo,
  });

  return (
    <div className="space-y-1">
      <form action={formAction} className="pt-1">
        <input type="hidden" name="referralId" value={referralId} />
        <PriceBreakdownConfirm
          breakdown={breakdown}
          triggerLabel={`Pay ₦${koboToNaira(feeKobo).toLocaleString()} to confirm`}
          pending={pending}
        />
        {state?.error && <p className="pt-1 text-xs text-red-600">{state.error}</p>}
      </form>
      <PromoCodeField orderId={referralId} orderType="referral" />
    </div>
  );
}

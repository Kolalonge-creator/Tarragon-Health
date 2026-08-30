"use client";

import { useActionState } from "react";
import { payForReferral } from "@/app/(dashboard)/patient/referrals/actions";
import { Button } from "@/components/ui/button";
import { PromoCodeField } from "@/components/promo-code-field";
import { koboToNaira } from "@tarragon/shared";

export function PayForReferralButton({ referralId, feeKobo }: { referralId: string; feeKobo: number }) {
  const [state, formAction, pending] = useActionState(payForReferral, undefined);

  return (
    <div className="space-y-1">
      <form action={formAction} className="pt-1">
        <input type="hidden" name="referralId" value={referralId} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Redirecting…" : `Pay ₦${koboToNaira(feeKobo).toLocaleString()} to confirm`}
        </Button>
        {state?.error && <p className="pt-1 text-xs text-red-600">{state.error}</p>}
      </form>
      <PromoCodeField orderId={referralId} orderType="referral" />
    </div>
  );
}

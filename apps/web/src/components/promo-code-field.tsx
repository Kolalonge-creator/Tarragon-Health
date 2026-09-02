"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PromoCodeOrderType } from "@/lib/billing/promo-codes";
import { redeemPromoCodeAction } from "@/lib/billing/promo-codes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Drop-in "have a promo code?" input for a lab/pharmacy/referral order
 * awaiting payment. Renders next to PayForLabOrderButton and its
 * pharmacy/referral siblings. Those buttons render in more than one page, so
 * on success this calls router.refresh() rather than a server-side
 * revalidatePath (which would need to know every render site) — that
 * re-fetches whatever page is actually showing, updating the payable amount.
 */
export function PromoCodeField({
  orderId,
  orderType,
}: {
  orderId: string;
  orderType: PromoCodeOrderType;
}) {
  const router = useRouter();
  const boundAction = redeemPromoCodeAction.bind(null, orderType);
  const [state, formAction, pending] = useActionState(boundAction, undefined);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <form action={formAction} className="flex items-center gap-2 pt-1">
      <input type="hidden" name="orderId" value={orderId} />
      <Input name="code" placeholder="Promo code" className="h-9 w-36" disabled={pending} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Applying…" : "Apply"}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">{state.success}</p>}
    </form>
  );
}

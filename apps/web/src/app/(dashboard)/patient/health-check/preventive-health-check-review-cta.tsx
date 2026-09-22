"use client";

import { useActionState } from "react";
import { buyPreventiveHealthCheckReview } from "./actions";
import { Button } from "@/components/ui/button";
import { koboToNaira } from "@tarragon/shared";

/**
 * The purchase step for a doctor's written plan on this year's Health Check
 * — see 20260922185300_preventive_health_check_review_sku.sql. Rendered by
 * page.tsx only when the product is actually is_active (buyable); the
 * action itself would refuse an inactive product anyway
 * (record_service_purchase_intent's own is_active check), but this
 * component never offers a button the backend can't honour.
 */
export function PreventiveHealthCheckReviewCta({ priceKobo }: { priceKobo: number }) {
  const [state, formAction, pending] = useActionState(buyPreventiveHealthCheckReview, undefined);

  return (
    <div className="space-y-2">
      <p className="text-charcoal-ink/60 dark:text-night-ink/60">
        Once your checks are in, a doctor on your care team can write back a plan for what to do
        next — ₦{koboToNaira(priceKobo).toLocaleString()}, a one-off purchase for this year&apos;s
        check.
      </p>
      <form action={formAction}>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Starting…" : "Request a doctor's review"}
        </Button>
      </form>
      {state?.error && <p className="text-xs text-red-600 dark:text-red-300">{state.error}</p>}
      {state?.message && (
        <p className="text-xs text-brand-green dark:text-brand-green-bright">{state.message}</p>
      )}
    </div>
  );
}

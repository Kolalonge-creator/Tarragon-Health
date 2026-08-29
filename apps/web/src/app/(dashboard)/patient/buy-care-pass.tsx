"use client";

import { useActionState } from "react";
import { buyCarePass, type BuyCarePassState } from "./care-pass-actions";
import { useActivePatientPlans } from "@/lib/queries/subscription-plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { koboToNaira } from "@tarragon/shared";

/**
 * E2 Care Pass — the one-off, no-auto-renewal replacement for the retired
 * Prevent/Essential/Complete subscription tiers. Deliberately separate from
 * SubscriptionManager's ordinary plan switcher (see the exclusion there and
 * in changePlan) because this is a single charge, not a recurring one.
 */
export function BuyCarePass() {
  const { data: plans } = useActivePatientPlans();
  const [state, formAction, isPending] = useActionState<BuyCarePassState, FormData>(
    buyCarePass,
    undefined,
  );

  const twelveMo = plans?.find((p) => p.code === "care_pass_12mo");
  const sixMo = plans?.find((p) => p.code === "care_pass_6mo");
  if (!twelveMo && !sixMo) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care Pass</CardTitle>
        <CardDescription>
          Chronic tracking, a clinician review of anything that drifts, and a written care plan — one
          payment, no card stored, no auto-renewal. When it lapses, you choose again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          {twelveMo && (
            <Button type="submit" name="planCode" value="care_pass_12mo" disabled={isPending}>
              {isPending ? "Starting checkout…" : `12 months — ₦${koboToNaira(twelveMo.price_minor).toLocaleString()}`}
            </Button>
          )}
          {sixMo && (
            <Button type="submit" name="planCode" value="care_pass_6mo" variant="outline" disabled={isPending}>
              {isPending ? "Starting checkout…" : `6 months — ₦${koboToNaira(sixMo.price_minor).toLocaleString()}`}
            </Button>
          )}
        </form>
        {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      </CardContent>
    </Card>
  );
}

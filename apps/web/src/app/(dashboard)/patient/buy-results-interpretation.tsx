"use client";

import { useActionState } from "react";
import {
  requestResultsInterpretation,
  type RequestResultsInterpretationState,
} from "./results-interpretation-actions";
import { useResultsInterpretationPrice } from "@/lib/queries/results-interpretation";
import { Button } from "@/components/ui/button";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

function formatPrice(amountMinor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency as Currency] ?? currency;
  return `${symbol}${koboToNaira(amountMinor).toLocaleString()}`;
}

/**
 * E3 Results Interpretation (Revenue Architecture and Earnings Plan, 27 Aug
 * 2026) — the one-off purchase path for a patient without paid-plan result
 * review access (Tarragon Free, or a paid plan that's lapsed). Pay once,
 * then upload any lab result the normal way (ResultDocuments below already
 * renders the upload form) — private.handle_lab_result_document() spends
 * the credit automatically on the next upload, no extra step here.
 */
export function BuyResultsInterpretation() {
  const { data: price } = useResultsInterpretationPrice();
  const [state, formAction, isPending] = useActionState<
    RequestResultsInterpretationState,
    FormData
  >(requestResultsInterpretation, undefined);

  return (
    <form action={formAction} className="rounded-lg border border-brand-green/20 bg-brand-green/5 p-3 space-y-2">
      <p className="text-sm font-medium text-charcoal-ink">
        Get this result explained by a doctor
      </p>
      <p className="text-xs text-charcoal-ink/60">
        A one-off review of any lab result you upload: a doctor&apos;s plain-language
        interpretation, sent to you in the app.
        {price ? ` ${formatPrice(price.amount_minor, price.currency)}, paid once.` : ""}
      </p>
      <Button type="submit" size="sm" variant="outline" disabled={isPending || !price}>
        {isPending ? "Starting checkout…" : price ? `Buy for ${formatPrice(price.amount_minor, price.currency)}` : "Loading…"}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

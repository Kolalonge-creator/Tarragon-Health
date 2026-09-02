"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PriceBreakdown } from "@/lib/billing/price-breakdown";
import { koboToNaira } from "@tarragon/shared";

/**
 * §91.6 itemized price transparency. Renders the trigger/confirm buttons for
 * a checkout form that submits via useActionState elsewhere — this
 * component only controls which button shows (a trigger, or the itemized
 * breakdown plus a real submit button); it never owns the form's
 * pending/submit state itself, so it must be rendered inside the same
 * `<form action={formAction}>` the trigger used to submit directly.
 *
 * Mirrors the expand/confirm interaction RequestPartnerLabVisit already
 * uses (apps/web/src/app/(dashboard)/patient/request-partner-lab-visit.tsx)
 * rather than introducing a modal/dialog primitive this codebase doesn't
 * have.
 */
export function PriceBreakdownConfirm({
  breakdown,
  triggerLabel,
  confirmLabel = "Confirm and pay",
  pending,
}: {
  breakdown: PriceBreakdown;
  triggerLabel: string;
  confirmLabel?: string;
  pending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <Button type="button" size="sm" onClick={() => setExpanded(true)}>
        {triggerLabel}
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 bg-warm-ivory/50 p-3">
      <ul className="space-y-1 text-sm">
        {breakdown.lines.map((line) => (
          <li key={line.label} className="flex justify-between gap-4">
            <span className="text-charcoal-ink/70">{line.label}</span>
            <span>₦{koboToNaira(line.amountKobo).toLocaleString()}</span>
          </li>
        ))}
        {breakdown.discounts.map((discount) => (
          <li key={discount.label} className="flex justify-between gap-4 text-brand-green">
            <span>{discount.label}</span>
            <span>−₦{koboToNaira(Math.abs(discount.amountKobo)).toLocaleString()}</span>
          </li>
        ))}
        {breakdown.vat.amountKobo > 0 && (
          <li className="flex justify-between gap-4 text-charcoal-ink/70">
            <span>VAT ({breakdown.vat.treatment})</span>
            <span>₦{koboToNaira(breakdown.vat.amountKobo).toLocaleString()}</span>
          </li>
        )}
        <li className="flex justify-between gap-4 border-t border-charcoal-ink/10 pt-1 font-medium">
          <span>Total</span>
          <span>₦{koboToNaira(breakdown.totalKobo).toLocaleString()}</span>
        </li>
      </ul>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Redirecting…" : confirmLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setExpanded(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

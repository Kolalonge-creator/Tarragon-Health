"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOpenConsultSlots, useVideoVisitPrice } from "@/lib/queries/consult-slots";
import {
  requestVideoVisit,
  type RequestVideoVisitState,
} from "@/app/(dashboard)/patient/video-visit-actions";
import { Button } from "@/components/ui/button";
import { CURRENCY_SYMBOL, koboToNaira, type Currency } from "@tarragon/shared";

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(amountMinor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency as Currency] ?? currency;
  return `${symbol}${koboToNaira(amountMinor).toLocaleString()}`;
}

const SOURCE_HELPER_TEXT: Record<Props["reason"], string> = {
  result_consult: "Talk through this result with a Tarragon doctor.",
  partner_lab_consult: "Included as part of this booking — pick a time for your consult.",
};

interface Props {
  reason: "result_consult" | "partner_lab_consult";
  sourceLabResultDocumentId?: string;
  sourceLabOrderId?: string;
}

/**
 * Auto-suggests the top 3 soonest open video-visit slots across every
 * clinician in the org (useOpenConsultSlots is already ordered
 * soonest-first) and requires an explicit tap to confirm — never books
 * silently. Confirming goes through the exact same requestVideoVisit
 * request->pay->doctor-accepts flow as any other video visit request on the
 * platform; nothing about the source ids changes pricing or the accept/
 * decline/refund lifecycle.
 *
 * On success requestVideoVisit redirects straight to hosted checkout, so
 * there is no in-page "success" state to react to here — only the error
 * path ever settles `state`, which is exactly when the picker should stay
 * open for a retry rather than collapse.
 *
 * Shared between the "discuss this with a doctor" CTA on an uploaded
 * result's AI summary and the inline consult bundle on a Synlab-billed
 * booking — reason only changes the copy, not the behaviour.
 */
export function SuggestedSlotPicker({ reason, sourceLabResultDocumentId, sourceLabOrderId }: Props) {
  const { data: slots } = useOpenConsultSlots();
  const { data: price } = useVideoVisitPrice();
  const queryClient = useQueryClient();
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [state, formAction, isPending] = useActionState<RequestVideoVisitState, FormData>(
    requestVideoVisit,
    undefined
  );

  useEffect(() => {
    if (state === undefined) return;
    // An error (e.g. the slot was taken in the meantime) means the picker
    // stays mounted for a retry — refresh availability so it doesn't offer
    // the same stale slot again.
    queryClient.invalidateQueries({ queryKey: ["consult-slots"] });
  }, [state, queryClient]);

  const suggested = (slots ?? []).slice(0, 3);

  if (suggested.length === 0) {
    return (
      <p className="text-sm text-charcoal-ink/60">
        No open times right now — check back shortly, or use the ordinary video-visit booking
        page.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <p className="text-sm text-charcoal-ink/70">{SOURCE_HELPER_TEXT[reason]}</p>
      {sourceLabResultDocumentId && (
        <input type="hidden" name="source_lab_result_document_id" value={sourceLabResultDocumentId} />
      )}
      {sourceLabOrderId && <input type="hidden" name="source_lab_order_id" value={sourceLabOrderId} />}
      <div className="flex flex-wrap gap-2">
        {suggested.map((slot) => (
          <Button
            key={slot.id}
            type="button"
            size="sm"
            variant={selectedSlot === slot.id ? "default" : "outline"}
            onClick={() => setSelectedSlot(slot.id)}
          >
            {formatSlot(slot.slot_start)}
            {slot.clinician?.full_name ? ` · Dr. ${slot.clinician.full_name}` : ""}
          </Button>
        ))}
      </div>
      <input type="hidden" name="slot_id" value={selectedSlot} />
      <Button type="submit" size="sm" disabled={!selectedSlot || isPending}>
        {isPending
          ? "Redirecting…"
          : `Confirm & pay${price ? ` ${formatPrice(price.amount_minor, price.currency)}` : ""}`}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

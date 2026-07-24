"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOpenConsultSlots,
  useUpcomingVideoVisits,
  useMyVideoVisitRequests,
  useVideoVisitPrice,
  consultSlotKeys,
} from "@/lib/queries/consult-slots";
import {
  requestVideoVisit,
  type RequestVideoVisitState,
} from "./video-visit-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

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

const REQUEST_STATUS: Record<
  string,
  { label: string; tone: "blue" | "amber" | "green" | "red" | "grey"; note?: string }
> = {
  requested: { label: "Awaiting payment", tone: "grey" },
  pending_payment: { label: "Awaiting payment", tone: "grey" },
  payment_confirmed: {
    label: "Paid, waiting for a doctor to accept",
    tone: "amber",
    note: "Your payment is held by Tarragon and only goes through when a doctor accepts. If no doctor can take it within 48 hours, you're refunded in full.",
  },
  accepted: { label: "Booked", tone: "green" },
  declined: {
    label: "Not available",
    tone: "red",
    note: "A doctor couldn't take this visit. Your payment will be refunded in full.",
  },
  expired: {
    label: "Not accepted in time",
    tone: "red",
    note: "No doctor could take this within 48 hours. Your payment will be refunded in full.",
  },
  cancelled: { label: "Cancelled", tone: "grey" },
  refunded: { label: "Refunded", tone: "grey" },
};

/**
 * Paid, doctor-accepted video visits (founder-specified flow, 2026-07-23):
 * request a published time → pay → the payment is HELD → a doctor accepts →
 * only then is the visit booked. Video only, availability-dependent, and
 * NEVER for emergencies — both stated in the card copy below. The old
 * instant-book path is gone (the RPC behind it was dropped).
 */
export function BookVideoVisit({ patientId }: { patientId: string }) {
  const { data: slots } = useOpenConsultSlots();
  const { data: upcoming } = useUpcomingVideoVisits(patientId);
  const { data: requests } = useMyVideoVisitRequests(patientId);
  const { data: price } = useVideoVisitPrice();
  const queryClient = useQueryClient();
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [state, formAction, isPending] = useActionState<RequestVideoVisitState, FormData>(
    requestVideoVisit,
    undefined
  );

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: consultSlotKeys.myRequests(patientId) });
  }, [state, queryClient, patientId]);

  const hasSlots = (slots ?? []).length > 0 && !!price;
  const hasUpcoming = (upcoming ?? []).length > 0;
  const hasRequests = (requests ?? []).length > 0;
  if (!hasSlots && !hasUpcoming && !hasRequests) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>15-minute telemedicine visit with a doctor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-700">
            Not for emergencies. If this is an emergency (severe chest pain, trouble
            breathing, sudden weakness, heavy bleeding), go to the nearest emergency
            department now.
          </p>
        </div>
        <p className="text-sm text-charcoal-ink/70">
          A paid, self-serve 15-minute video consultation with a Tarragon doctor, not an
          in-person visit. Pick a time and pay: your payment is{" "}
          <span className="font-medium">held by Tarragon</span> and only goes through when a
          doctor accepts your request; that&apos;s also when your time is confirmed. Visits
          depend on doctor availability and are not guaranteed until accepted. If no doctor can
          take your request, you get a full refund.
        </p>

        {hasUpcoming && (
          <div className="space-y-1">
            {(upcoming ?? []).map((visit) => (
              <p key={visit.id} className="text-sm text-charcoal-ink">
                Booked:{" "}
                <span className="font-medium">
                  {visit.scheduled_at ? formatSlot(visit.scheduled_at) : "time TBC"}
                </span>
                {visit.join_url && (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={visit.join_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-green hover:underline"
                    >
                      Join link
                    </a>
                  </>
                )}
              </p>
            ))}
          </div>
        )}

        {hasSlots && (
          <form action={formAction} className="space-y-3">
            <p className="text-sm font-medium text-charcoal-ink">
              Request a time: {formatPrice(price!.amount_minor, price!.currency)} per visit
            </p>
            <div className="flex flex-wrap gap-2">
              {(slots ?? []).map((slot) => (
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
            <Button type="submit" disabled={!selectedSlot || isPending}>
              {isPending
                ? "Redirecting…"
                : `Request & pay ${price ? formatPrice(price.amount_minor, price.currency) : ""}`}
            </Button>
            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          </form>
        )}

        {hasRequests && (
          <ul className="divide-y divide-charcoal-ink/10 border-t border-charcoal-ink/10">
            {(requests ?? []).map((req) => {
              const status = REQUEST_STATUS[req.status] ?? {
                label: req.status,
                tone: "grey" as const,
              };
              return (
                <li key={req.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-charcoal-ink">
                      {req.slot?.slot_start ? formatSlot(req.slot.slot_start) : "Requested visit"}
                    </p>
                    <Badge variant={status.tone}>{status.label}</Badge>
                  </div>
                  {status.note && (
                    <p className="text-xs text-charcoal-ink/60">{status.note}</p>
                  )}
                  {req.status === "declined" && req.declined_reason && (
                    <p className="text-xs text-charcoal-ink/60">
                      Doctor&apos;s note: {req.declined_reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

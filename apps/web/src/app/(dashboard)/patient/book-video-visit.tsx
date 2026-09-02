"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOpenConsultSlots,
  useUpcomingVideoVisits,
  useMyVideoVisitRequests,
  useVideoVisitPrice,
  useVideoVisitAcceptanceStats,
  useRecentUnratedVideoVisits,
  consultSlotKeys,
} from "@/lib/queries/consult-slots";
import {
  requestVideoVisit,
  selectVideoVisitAlternateSlot,
  submitConsultationFeedback,
  type RequestVideoVisitState,
  type SelectAlternateSlotState,
  type SubmitFeedbackState,
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

/** "45 minutes" / "2 hours" — median_minutes_to_accept reads oddly as a raw
 * number once it crosses an hour, so round to the coarser unit above 90. */
function formatMinutes(minutes: number): string {
  if (minutes < 90) return `${Math.max(minutes, 1)} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
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
    note: "Your payment is held by Tarragon and only goes through once a time is confirmed. A doctor will accept your time — or offer a different one that works — within 48 hours. If nobody can, you're refunded in full.",
  },
  alternate_proposed: {
    label: "Your doctor offered different times",
    tone: "amber",
    note: "Your original time didn't work, so your doctor offered these instead — pick one below within 24 hours or you're refunded in full.",
  },
  accepted: { label: "Booked", tone: "green" },
  declined: {
    label: "Not available",
    tone: "red",
    note: "A doctor couldn't take this visit. Your payment is being refunded in full automatically — you don't need to do anything or contact support.",
  },
  expired: {
    label: "Not accepted in time",
    tone: "red",
    note: "Nobody confirmed a time in time. Your payment will be refunded in full.",
  },
  cancelled: { label: "Cancelled", tone: "grey" },
  refunded: { label: "Refunded", tone: "grey" },
};

const RATING_LABELS = [1, 2, 3, 4, 5];

/** Consultation System §9.20 — prompts for a rating on a recently completed, unrated visit. */
function VideoVisitFeedbackPrompt({ consultationId }: { consultationId: string }) {
  const queryClient = useQueryClient();
  const [overall, setOverall] = useState<number>(0);
  const [state, formAction, isPending] = useActionState<SubmitFeedbackState, FormData>(
    submitConsultationFeedback,
    undefined
  );

  useEffect(() => {
    if (state?.message) {
      queryClient.invalidateQueries({ queryKey: ["video-consultations", "recent-completed"] });
    }
  }, [state, queryClient]);

  if (state?.message) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-charcoal-ink/70">{state.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How was your video visit?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="consultation_id" value={consultationId} />
          <input type="hidden" name="overall_rating" value={overall || ""} />
          <div className="flex gap-1">
            {RATING_LABELS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setOverall(n)}
                className={`h-9 w-9 rounded-full text-sm font-medium ${
                  overall >= n ? "bg-brand-green text-white" : "bg-charcoal-ink/10 text-charcoal-ink/60"
                }`}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <Button type="submit" size="sm" disabled={overall === 0 || isPending}>
            {isPending ? "Sending…" : "Send feedback"}
          </Button>
          {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * One form, one submit button per offered time — the button that was
 * actually clicked contributes its own name/value pair to the FormData
 * (standard HTML submit-button semantics), so the server action reads
 * exactly which of the doctor's proposed times the patient picked.
 */
function AlternateSlotPicker({
  requestId,
  slots,
}: {
  requestId: string;
  slots: { id: string; slot_start: string }[];
}) {
  const queryClient = useQueryClient();
  const [state, formAction, isPending] = useActionState<SelectAlternateSlotState, FormData>(
    selectVideoVisitAlternateSlot,
    undefined
  );

  useEffect(() => {
    if (state === undefined) return;
    queryClient.invalidateQueries({ queryKey: ["video-visit-requests"] });
    queryClient.invalidateQueries({ queryKey: ["consult-slots"] });
  }, [state, queryClient]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="request_id" value={requestId} />
      <div className="flex flex-wrap gap-2">
        {slots.map((slot) => (
          <Button key={slot.id} type="submit" name="slot_id" value={slot.id} size="sm" disabled={isPending}>
            {isPending ? "Booking…" : formatSlot(slot.slot_start)}
          </Button>
        ))}
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

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
  const { data: acceptanceStats } = useVideoVisitAcceptanceStats();
  const { data: unrated } = useRecentUnratedVideoVisits(patientId);
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
  const hasUnrated = (unrated ?? []).length > 0;
  if (!hasSlots && !hasUpcoming && !hasRequests && !hasUnrated) return null;

  return (
    <div id="book-video-visit" className="space-y-4">
    {hasUnrated &&
      (unrated ?? []).map((visit) => <VideoVisitFeedbackPrompt key={visit.id} consultationId={visit.id} />)}
    {(hasSlots || hasUpcoming || hasRequests) && (
    <Card>
      <CardHeader>
        <CardTitle>15-minute online consultation with a doctor</CardTitle>
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
          A paid, self-serve 15-minute online consultation with a Tarragon doctor, over
          video. Pick a time and pay: your payment is{" "}
          <span className="font-medium">held by Tarragon</span> and only goes through once a
          time is confirmed — either your doctor accepts the time you picked, or offers a
          different time that works better for them, within 48 hours. If nobody can take it,
          you get a full refund.
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
                {" "}
                ·{" "}
                <Link href={`/patient/video-visit/${visit.id}`} className="text-brand-green hover:underline">
                  Prepare / manage
                </Link>
              </p>
            ))}
          </div>
        )}

        {hasSlots && (
          <form action={formAction} className="space-y-3">
            {acceptanceStats && (
              <p className="text-xs text-charcoal-ink/60">
                {acceptanceStats.suppressed
                  ? "Not enough recent requests here yet to show a reliable acceptance estimate."
                  : `In the last 30 days, ${acceptanceStats.acceptance_rate_pct}% of requests like this were accepted, usually within about ${formatMinutes(acceptanceStats.median_minutes_to_accept)}.`}
              </p>
            )}
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
                  {req.status === "alternate_proposed" && req.proposedSlots.length > 0 && (
                    <AlternateSlotPicker requestId={req.id} slots={req.proposedSlots} />
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
    )}
    </div>
  );
}

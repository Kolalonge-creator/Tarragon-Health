"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOrgVideoVisitRequests,
  useMyConsultSlots,
  consultSlotKeys,
  type VideoVisitRequestWithPatient,
  type ProposedSlot,
} from "@/lib/queries/consult-slots";
import {
  acceptVideoVisit,
  declineVideoVisit,
  proposeVideoVisitAlternates,
  type VideoVisitDecisionState,
} from "./actions";
import { useCurrentOnCall } from "@/lib/queries/clinician-rota";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

type QueueRequest = VideoVisitRequestWithPatient & { proposedSlots: ProposedSlot[] };

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProposeAlternatesForm({ request, onDone }: { request: QueueRequest; onDone: () => void }) {
  const { data: mySlots } = useMyConsultSlots();
  const [selected, setSelected] = useState<string[]>([]);
  const [state, formAction, isPending] = useActionState<VideoVisitDecisionState, FormData>(
    proposeVideoVisitAlternates,
    undefined
  );

  useEffect(() => {
    if (state?.message) onDone();
  }, [state?.message, onDone]);

  const openSlots = (mySlots ?? []).filter((s) => !s.booked_consultation_id);

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <input type="hidden" name="request_id" value={request.id} />
      <p className="text-xs font-medium text-charcoal-ink">Offer up to 3 alternate times</p>
      {openSlots.length === 0 && (
        <p className="text-xs text-charcoal-ink/60">
          You have no other open published times right now — publish one on this page first.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {openSlots.map((slot) => {
          const checked = selected.includes(slot.id);
          return (
            <label key={slot.id} className="flex items-center gap-1.5 text-xs text-charcoal-ink">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={checked}
                onChange={(e) => {
                  setSelected((prev) => {
                    if (e.target.checked) {
                      return prev.length >= 3 ? prev : [...prev, slot.id];
                    }
                    return prev.filter((id) => id !== slot.id);
                  });
                }}
              />
              {formatSlot(slot.slot_start)}
            </label>
          );
        })}
      </div>
      {selected.map((id) => (
        <input key={id} type="hidden" name="slot_ids" value={id} />
      ))}
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={selected.length === 0 || isPending}>
          {isPending ? "Sending…" : "Offer these times"}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

function RequestRow({ request }: { request: QueueRequest }) {
  const queryClient = useQueryClient();
  const [showPropose, setShowPropose] = useState(false);
  const [acceptState, acceptAction, acceptPending] = useActionState<
    VideoVisitDecisionState,
    FormData
  >(acceptVideoVisit, undefined);
  const [declineState, declineAction, declinePending] = useActionState<
    VideoVisitDecisionState,
    FormData
  >(declineVideoVisit, undefined);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: consultSlotKeys.orgRequests });
    queryClient.invalidateQueries({ queryKey: consultSlotKeys.mine });
  };

  useEffect(() => {
    if (acceptState?.message || declineState?.message) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptState?.message, declineState?.message]);

  const symbol = CURRENCY_SYMBOL[request.currency as Currency] ?? request.currency;
  const busy = acceptPending || declinePending;
  const awaitingPatient = request.status === "alternate_proposed";

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {request.patient?.full_name ?? "Patient"}
          {request.patient?.patient_number ? ` · ${request.patient.patient_number}` : ""}
        </p>
        <Badge variant="amber">
          Paid {symbol}
          {koboToNaira(request.amount_minor).toLocaleString()}, held
        </Badge>
        {awaitingPatient && <Badge variant="blue">Waiting for patient to pick a time</Badge>}
      </div>
      <p className="text-sm text-charcoal-ink">
        Requested time:{" "}
        <span className="font-medium">
          {request.slot?.slot_start ? formatSlot(request.slot.slot_start) : "—"}
        </span>
      </p>
      {request.note && (
        <p className="text-xs text-charcoal-ink/60">Patient note: {request.note}</p>
      )}
      {awaitingPatient && request.proposedSlots.length > 0 && (
        <p className="text-xs text-charcoal-ink/60">
          Offered: {request.proposedSlots.map((s) => formatSlot(s.slot_start)).join(" · ")}
        </p>
      )}

      {!awaitingPatient && !showPropose && (
        <div className="flex flex-wrap items-end gap-2">
          <form action={acceptAction}>
            <input type="hidden" name="request_id" value={request.id} />
            <Button size="sm" type="submit" disabled={busy}>
              {acceptPending ? "Accepting…" : "Accept & book"}
            </Button>
          </form>
          <Button size="sm" type="button" variant="outline" onClick={() => setShowPropose(true)}>
            Propose different times
          </Button>
        </div>
      )}
      {!awaitingPatient && showPropose && (
        <ProposeAlternatesForm
          request={request}
          onDone={() => {
            setShowPropose(false);
            refresh();
          }}
        />
      )}

      <form action={declineAction} className="flex flex-1 items-end gap-2">
        <input type="hidden" name="request_id" value={request.id} />
        <Input
          name="reason"
          placeholder="Reason if declining (shared with the patient)"
          className="h-8 min-w-48 flex-1 text-xs"
        />
        <Button size="sm" type="submit" variant="outline" disabled={busy}>
          {declinePending ? "Declining…" : "Decline & refund"}
        </Button>
      </form>

      {acceptState?.error && <p className="text-xs text-red-600">{acceptState.error}</p>}
      {declineState?.error && <p className="text-xs text-red-600">{declineState.error}</p>}
      {(acceptState?.message || declineState?.message) && (
        <p className="text-xs text-brand-green">
          {acceptState?.message ?? declineState?.message}
        </p>
      )}
    </li>
  );
}

/**
 * The held-payment queue: paid video-visit requests waiting for a doctor's
 * explicit acceptance. Accepting books the patient's requested slot;
 * proposing offers up to 3 alternate published times instead ("arrange a
 * convenient time", founder ask 2026-07-31 — the doctor doesn't have to
 * choose between the exact requested slot or an outright decline); declining
 * triggers a full refund. Acceptance/proposal/decline are doctor-tier gated
 * structurally in the DB — this UI just makes the queue visible.
 */
export function VideoVisitRequestQueue() {
  const { data, isLoading, isError } = useOrgVideoVisitRequests();
  const { data: onCall, isLoading: onCallLoading } = useCurrentOnCall("video");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Online consultation requests</CardTitle>
      </CardHeader>
      <CardContent>
        {!onCallLoading && (onCall?.length ?? 0) > 0 && (
          <p className="mb-2 text-xs text-charcoal-ink/70">
            On call now:{" "}
            {onCall!.map((c) => c.full_name).join(", ")}
          </p>
        )}
        {!onCallLoading && (onCall?.length ?? 0) === 0 && (
          <p className="mb-2 text-xs text-amber-700">
            No one is on the published rota right now — any active doctor can still accept these.
          </p>
        )}
        <p className="mb-3 text-xs text-charcoal-ink/60">
          Patients have already paid for these; the money is held until a time is confirmed.
          Accept their requested time, propose different times that work better for you, or
          decline with a reason — either way, respond within 48 hours or the patient is
          refunded automatically.
        </p>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load requests.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No requests waiting.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((request) => (
              <RequestRow key={request.id} request={request} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

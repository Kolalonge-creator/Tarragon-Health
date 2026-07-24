"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOrgVideoVisitRequests,
  consultSlotKeys,
  type VideoVisitRequestWithPatient,
} from "@/lib/queries/consult-slots";
import {
  acceptVideoVisit,
  declineVideoVisit,
  type VideoVisitDecisionState,
} from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

function RequestRow({ request }: { request: VideoVisitRequestWithPatient }) {
  const queryClient = useQueryClient();
  const [acceptState, acceptAction, acceptPending] = useActionState<
    VideoVisitDecisionState,
    FormData
  >(acceptVideoVisit, undefined);
  const [declineState, declineAction, declinePending] = useActionState<
    VideoVisitDecisionState,
    FormData
  >(declineVideoVisit, undefined);

  useEffect(() => {
    if (acceptState?.message || declineState?.message) {
      queryClient.invalidateQueries({ queryKey: consultSlotKeys.orgRequests });
      queryClient.invalidateQueries({ queryKey: consultSlotKeys.mine });
    }
  }, [acceptState?.message, declineState?.message, queryClient]);

  const symbol = CURRENCY_SYMBOL[request.currency as Currency] ?? request.currency;
  const busy = acceptPending || declinePending;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {request.patient?.full_name ?? "Patient"}
          {request.patient?.patient_number ? ` · ${request.patient.patient_number}` : ""}
        </p>
        <Badge variant="amber">
          Paid {symbol}
          {koboToNaira(request.amount_minor).toLocaleString()} — held
        </Badge>
      </div>
      <p className="text-sm text-charcoal-ink">
        Requested time:{" "}
        <span className="font-medium">
          {request.slot?.slot_start
            ? new Date(request.slot.slot_start).toLocaleString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"}
        </span>
      </p>
      {request.note && (
        <p className="text-xs text-charcoal-ink/60">Patient note: {request.note}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <form action={acceptAction}>
          <input type="hidden" name="request_id" value={request.id} />
          <Button size="sm" type="submit" disabled={busy}>
            {acceptPending ? "Accepting…" : "Accept & book"}
          </Button>
        </form>
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
      </div>
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
 * explicit acceptance. Accepting books the slot and lets the payment stand;
 * declining triggers a full refund. Acceptance is doctor-tier gated
 * structurally in the DB — this UI just makes the queue visible.
 */
export function VideoVisitRequestQueue() {
  const { data, isLoading, isError } = useOrgVideoVisitRequests();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Video visit requests</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">
          Patients have already paid for these — the money is held until you accept.
          Accept to book the time, or decline with a reason and the patient is refunded in
          full.
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

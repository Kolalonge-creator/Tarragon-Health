"use client";

import { useActionState, useEffect, useId } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOrgLabResultConsultRequests,
  labResultConsultKeys,
  type LabResultConsultRequestWithPatient,
} from "@/lib/queries/lab-result-consult";
import {
  acceptLabResultConsultRequest,
  type LabResultConsultDecisionState,
} from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** No shared date-time-picker component exists in this codebase yet (a
 * plain `<input type="datetime-local">` is the established pattern — see
 * clinician/annual-reviews/page.tsx and clinician/availability's own
 * availability-manager.tsx). Kept as a local minimum-15-minutes-from-now
 * default so a doctor isn't staring at an empty field. */
function defaultLocalDateTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  d.setSeconds(0, 0);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function RequestRow({ request }: { request: LabResultConsultRequestWithPatient }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [acceptState, acceptAction, acceptPending] = useActionState<
    LabResultConsultDecisionState,
    FormData
  >(acceptLabResultConsultRequest, undefined);

  useEffect(() => {
    if (acceptState?.message) {
      queryClient.invalidateQueries({ queryKey: labResultConsultKeys.orgRequests });
    }
  }, [acceptState?.message, queryClient]);

  const symbol = CURRENCY_SYMBOL[request.currency as Currency] ?? request.currency;
  const uploaded = request.status === "document_uploaded";

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {request.patient?.full_name ?? "Patient"}
          {request.patient?.patient_number ? ` · ${request.patient.patient_number}` : ""}
        </p>
        <Badge variant="amber">
          Paid {symbol}
          {koboToNaira(request.amount_minor).toLocaleString()}
        </Badge>
        {uploaded ? (
          <Badge variant="blue">Result uploaded</Badge>
        ) : (
          <Badge variant="grey">Awaiting upload</Badge>
        )}
      </div>
      {request.note && (
        <p className="text-xs text-charcoal-ink/60">Patient note: {request.note}</p>
      )}
      <p className="text-xs text-charcoal-ink/60">
        Requested {formatDate(request.created_at)}
      </p>

      {!acceptState?.message && (
        <form action={acceptAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="request_id" value={request.id} />
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-when`} className="text-xs">
              Date &amp; time for the 15-minute call
            </Label>
            <Input
              id={`${fieldId}-when`}
              type="datetime-local"
              name="scheduled_at"
              defaultValue={defaultLocalDateTime()}
              required
              className="h-8 w-auto text-xs"
            />
          </div>
          <Button size="sm" type="submit" disabled={acceptPending}>
            {acceptPending ? "Booking…" : "Book this time"}
          </Button>
        </form>
      )}

      {acceptState?.error && <p className="text-xs text-red-600">{acceptState.error}</p>}
      {acceptState?.message && (
        <p className="text-xs font-medium text-brand-green">{acceptState.message}</p>
      )}
    </li>
  );
}

/**
 * The doctor-side queue for the self-arranged lab-result consultation fee
 * (founder ask, 2026-08-30): every request that's been paid for, waiting on
 * a doctor to pick a time for the 15-minute walkthrough. Any active,
 * non-Care-Coordinator clinician on the org's care team can pick one up —
 * this is routine first-line scheduling, not prescribing or emergency
 * authority, so no doctor-tier threshold is required (see
 * accept_lab_result_consult_request's own comment).
 */
export function LabResultConsultQueue() {
  const { data, isLoading, isError } = useOrgLabResultConsultRequests();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab-result consultation requests</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">
          Patients have paid the consultation fee for a walkthrough of a self-arranged lab
          result. Pick a time that works for you — a video link is generated automatically
          and the patient is told.
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

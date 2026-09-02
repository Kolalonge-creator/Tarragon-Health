"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOrgLabResultConsultRequests,
  useMyAcceptedLabResultConsultRequests,
  labResultConsultKeys,
  type LabResultConsultRequestWithPatient,
} from "@/lib/queries/lab-result-consult";
import {
  acceptLabResultConsultRequest,
  rescheduleLabResultConsultRequest,
  releaseLabResultConsultRequest,
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

function AcceptedRequestRow({ request }: { request: LabResultConsultRequestWithPatient }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleState, rescheduleAction, reschedulePending] = useActionState<
    LabResultConsultDecisionState,
    FormData
  >(rescheduleLabResultConsultRequest, undefined);
  const [releaseState, releaseAction, releasePending] = useActionState<
    LabResultConsultDecisionState,
    FormData
  >(releaseLabResultConsultRequest, undefined);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: labResultConsultKeys.myAccepted });
    queryClient.invalidateQueries({ queryKey: labResultConsultKeys.orgRequests });
  };

  useEffect(() => {
    if (rescheduleState?.message) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescheduleState?.message]);
  useEffect(() => {
    if (releaseState?.message) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseState?.message]);

  const busy = reschedulePending || releasePending;
  // A completed reschedule folds the sub-form back down without a
  // synchronous setState-in-effect — the success message itself is the
  // signal, not a side-effect-driven state reset.
  const rescheduleDone = Boolean(rescheduleState?.message);

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {request.patient?.full_name ?? "Patient"}
          {request.patient?.patient_number ? ` · ${request.patient.patient_number}` : ""}
        </p>
        <Badge variant="green">Booked</Badge>
      </div>

      {(!showReschedule || rescheduleDone) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => setShowReschedule(true)}
          >
            Reschedule
          </Button>
          <form action={releaseAction}>
            <input type="hidden" name="request_id" value={request.id} />
            <Button size="sm" type="submit" variant="ghost" className="text-red-600" disabled={busy}>
              {releasePending ? "Releasing…" : "Release (can&apos;t make it)"}
            </Button>
          </form>
        </div>
      )}

      {showReschedule && !rescheduleDone && (
        <form action={rescheduleAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="request_id" value={request.id} />
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-resched`} className="text-xs">
              New date &amp; time
            </Label>
            <Input
              id={`${fieldId}-resched`}
              type="datetime-local"
              name="scheduled_at"
              defaultValue={defaultLocalDateTime()}
              required
              className="h-8 w-auto text-xs"
            />
          </div>
          <Button size="sm" type="submit" disabled={reschedulePending}>
            {reschedulePending ? "Saving…" : "Save new time"}
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setShowReschedule(false)}>
            Cancel
          </Button>
        </form>
      )}

      {rescheduleState?.error && <p className="text-xs text-red-600">{rescheduleState.error}</p>}
      {releaseState?.error && <p className="text-xs text-red-600">{releaseState.error}</p>}
      {(rescheduleState?.message || releaseState?.message) && (
        <p className="text-xs font-medium text-brand-green">
          {rescheduleState?.message ?? releaseState?.message}
        </p>
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
  const { data: mine, isLoading: mineLoading } = useMyAcceptedLabResultConsultRequests();

  return (
    <div className="space-y-4">
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

      <Card>
        <CardHeader>
          <CardTitle>Your booked lab-result consults</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-charcoal-ink/60">
            Reschedule if a better time works, or release it back to the queue if you can no
            longer make it — the patient&apos;s paid fee is untouched either way.
          </p>
          {mineLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {mine && mine.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing booked right now.</p>
          )}
          {mine && mine.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {mine.map((request) => (
                <AcceptedRequestRow key={request.id} request={request} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

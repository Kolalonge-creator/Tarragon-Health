"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ESCALATION_HANDOVER_STATUS_LABEL,
  handoverDeclineProblem,
  handoverRequestProblem,
  isEscalationHandoverStatus,
  isHandoverOverdue,
} from "@tarragon/shared";
import {
  useCancelHandover,
  useEscalationHandovers,
  useRequestHandover,
  useRespondHandover,
  type EscalationHandover,
} from "@/lib/queries/escalations";
import { useAssignableDoctors } from "@/lib/queries/clinical-staff";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

function formatLagos(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorText(error: unknown, fallback: string): string {
  return (error as { message?: string } | null)?.message || fallback;
}

/**
 * G10 (DW-16..19): hand this case to another doctor. The current doctor keeps it until the new doctor accepts; the new doctor
 * can decline with a reason. The database functions are the real gate; `canRequest`, the viewer's id and `isCmo` only decide
 * what to draw.
 */
export function HandoverCard({
  escalationId,
  assignedProfileId,
  viewerProfileId,
  canRequest,
  isCmo,
}: {
  escalationId: string;
  assignedProfileId: string | null;
  viewerProfileId: string | null;
  /** The case is open, has a doctor, and the viewer is that doctor or the CMO. */
  canRequest: boolean;
  isCmo: boolean;
}) {
  const { data: handovers, isLoading, isError } = useEscalationHandovers(escalationId);
  // Kept here, not in PendingHandover: once the list refetches, the waiting handover is gone and that block unmounts.
  const [supersededNotice, setSupersededNotice] = useState(false);
  const pending = handovers?.find((h) => h.status === "pending") ?? null;
  const history = (handovers ?? []).filter((h) => h.status !== "pending");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Handover</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {supersededNotice && (
          <p className="text-sm text-charcoal-ink/80" role="status">
            That handover no longer applies: the case was closed or reassigned while it was waiting. Nothing changed.
          </p>
        )}
        {isLoading ? (
          <p className="text-sm text-charcoal-ink/60">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-red-600">Could not load handovers. Refresh to try again.</p>
        ) : pending ? (
          <PendingHandover
            escalationId={escalationId}
            handover={pending}
            viewerProfileId={viewerProfileId}
            isCmo={isCmo}
            onSuperseded={() => setSupersededNotice(true)}
          />
        ) : canRequest && assignedProfileId ? (
          <RequestForm escalationId={escalationId} assignedProfileId={assignedProfileId} />
        ) : (
          <p className="text-sm text-charcoal-ink/60">
            {assignedProfileId
              ? "Only the doctor this case is assigned to, or the Chief Medical Officer, can hand it over."
              : "This case has no doctor yet, so there is nothing to hand over."}
          </p>
        )}

        {history.length > 0 && (
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-4">
            <h3 className="text-sm font-medium text-charcoal-ink">Earlier handovers</h3>
            <ul className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="text-sm text-charcoal-ink">
                  <span className="font-medium">
                    {h.from_name ?? "A doctor"} to {h.to_name ?? "a doctor"}:{" "}
                    {isEscalationHandoverStatus(h.status) ? ESCALATION_HANDOVER_STATUS_LABEL[h.status] : h.status}
                  </span>
                  <span className="text-charcoal-ink/60">
                    {" "}
                    · asked {formatLagos(h.requested_at)}
                    {h.responded_at ? ` · answered ${formatLagos(h.responded_at)}` : ""}
                  </span>
                  <p className="text-charcoal-ink/80">Reason: {h.reason}</p>
                  {h.decline_reason && <p className="text-charcoal-ink/80">Declined because: {h.decline_reason}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingHandover({
  escalationId,
  handover,
  viewerProfileId,
  isCmo,
  onSuperseded,
}: {
  escalationId: string;
  handover: EscalationHandover;
  viewerProfileId: string | null;
  isCmo: boolean;
  onSuperseded: () => void;
}) {
  const router = useRouter();
  const respond = useRespondHandover();
  const cancel = useCancelHandover();
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declineProblem, setDeclineProblem] = useState<string | null>(null);

  const isTarget = viewerProfileId !== null && viewerProfileId === handover.to_profile_id;
  const canCancel =
    viewerProfileId !== null && (viewerProfileId === handover.from_profile_id || viewerProfileId === handover.requested_by || isCmo);
  // Safe to read the clock here: handovers load in the browser (React Query, no server data), so this never renders on the server.
  const overdue = isHandoverOverdue(handover, new Date());

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-charcoal-ink">
        <p className="font-medium">
          {isTarget ? "This case is being handed to you" : `Waiting for ${handover.to_name ?? "the new doctor"} to accept`}
          {handover.is_critical && <span className="ml-2 text-red-700">Emergency-level case</span>}
        </p>
        <p className="text-charcoal-ink/70">
          From {handover.from_name ?? "the current doctor"}
          {handover.requested_by !== handover.from_profile_id && handover.requested_by_name
            ? `, asked by ${handover.requested_by_name}`
            : ""}{" "}
          · {formatLagos(handover.requested_at)} · answer by {formatLagos(handover.acknowledge_by)}
          {overdue && <span className="ml-1 font-medium text-red-700">(overdue)</span>}
        </p>
        <p className="mt-2">
          <span className="font-medium">Reason:</span> {handover.reason}
        </p>
        <p>
          <span className="font-medium">Still to do:</span> {handover.outstanding_action}
        </p>
        <p className="mt-2 text-charcoal-ink/70">
          {handover.from_name ?? "The current doctor"} stays responsible for this case until it is accepted.
        </p>
      </div>

      {isTarget && !declining && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={respond.isPending}
            onClick={() =>
              respond.mutate(
                { escalationId, handoverId: handover.id, accept: true },
                {
                  onSuccess: (status) => {
                    if (status === "superseded") onSuperseded();
                    router.refresh();
                  },
                },
              )
            }
          >
            Accept this case
          </Button>
          <Button variant="outline" disabled={respond.isPending} onClick={() => setDeclining(true)}>
            Decline
          </Button>
        </div>
      )}

      {isTarget && declining && (
        <div className="space-y-2">
          <Label htmlFor="handover-decline-reason">Why are you declining?</Label>
          <Textarea
            id="handover-decline-reason"
            value={declineReason}
            maxLength={1000}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder="For example: at my case limit today, or outside my area"
          />
          {declineProblem && (
            <p className="text-sm text-red-600" role="alert">
              {declineProblem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={respond.isPending}
              onClick={() => {
                const problem = handoverDeclineProblem(declineReason);
                setDeclineProblem(problem);
                if (problem) return;
                respond.mutate(
                  { escalationId, handoverId: handover.id, accept: false, declineReason },
                  {
                    onSuccess: (status) => {
                      if (status === "superseded") onSuperseded();
                      router.refresh();
                    },
                  },
                );
              }}
            >
              Send decline
            </Button>
            <Button variant="ghost" disabled={respond.isPending} onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </div>
      )}

      {respond.isError && (
        <p className="text-sm text-red-600" role="alert">
          {errorText(respond.error, "Could not save your answer. Try again.")}
        </p>
      )}

      {canCancel && !isTarget && (
        <div className="space-y-1">
          <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate({ escalationId, handoverId: handover.id })}>
            Cancel handover
          </Button>
          {cancel.isError && (
            <p className="text-sm text-red-600" role="alert">
              {errorText(cancel.error, "Could not cancel. Try again.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RequestForm({ escalationId, assignedProfileId }: { escalationId: string; assignedProfileId: string }) {
  const request = useRequestHandover();
  const { data: doctors, isError: doctorsFailed } = useAssignableDoctors();
  const [toProfileId, setToProfileId] = useState("");
  const [reason, setReason] = useState("");
  const [outstandingAction, setOutstandingAction] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-sm text-charcoal-ink/70">
        The case stays with its current doctor until the new doctor accepts it. They can decline with a reason.
      </p>
      <div className="space-y-2">
        <Label htmlFor="handover-to">Hand to</Label>
        <Select id="handover-to" value={toProfileId} onChange={(e) => setToProfileId(e.target.value)}>
          <option value="">Choose a doctor</option>
          {(doctors ?? [])
            .filter((d) => d.profile_id && d.profile_id !== assignedProfileId)
            .map((d) => (
              <option key={d.profile_id} value={d.profile_id ?? ""}>
                {d.full_name}
              </option>
            ))}
        </Select>
        {doctorsFailed && <p className="text-sm text-red-600">Could not load the list of doctors. Refresh to try again.</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="handover-reason">Why are you handing it over?</Label>
        <Textarea id="handover-reason" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="handover-outstanding">What still needs doing?</Label>
        <Textarea
          id="handover-outstanding"
          value={outstandingAction}
          maxLength={1000}
          onChange={(e) => setOutstandingAction(e.target.value)}
          placeholder="The next step the new doctor must take"
        />
      </div>
      {(problem || request.isError) && (
        <p className="text-sm text-red-600" role="alert">
          {problem ?? errorText(request.error, "Could not send the handover. Try again.")}
        </p>
      )}
      <Button
        disabled={request.isPending}
        onClick={() => {
          const p = handoverRequestProblem({ toProfileId, reason, outstandingAction });
          setProblem(p);
          if (p) return;
          request.mutate(
            { escalationId, toProfileId, reason, outstandingAction },
            {
              onSuccess: () => {
                setReason("");
                setOutstandingAction("");
                setToProfileId("");
              },
            },
          );
        }}
      >
        Hand over
      </Button>
    </div>
  );
}

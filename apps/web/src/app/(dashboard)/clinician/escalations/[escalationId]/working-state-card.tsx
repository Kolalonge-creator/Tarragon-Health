"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ESCALATION_MONITORING_MAX_DAYS,
  ESCALATION_STATUS_LABEL,
  WORKING_ESCALATION_STATUSES,
  isWorkingEscalationStatus,
  workingStateProblem,
  type EscalationStatus,
  type WorkingEscalationStatus,
} from "@tarragon/shared";
import { useChangeMonitoringDate, useMoveEscalationState } from "@/lib/queries/escalations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const STATE_HELP: Record<WorkingEscalationStatus, string> = {
  awaiting_information: "You are waiting for something before you can decide: an outside result, a letter, a call back.",
  patient_contact_required: "The next step is reaching the patient. Log each attempt below.",
  monitoring: `Watch and wait. Choose a review-by date up to ${ESCALATION_MONITORING_MAX_DAYS} days away; the case comes back to you on that date by itself.`,
};

function formatLagos(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A datetime-local value typed in Lagos time (UTC+1, no daylight saving) as an ISO instant. */
function lagosInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}:00+01:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * DW-03: where the case stands, and (for its owner) the control to move it between working states.
 * Shown once review has started; an open case is started from the worklist first.
 */
export function WorkingStateCard({
  escalationId,
  organisationId,
  status,
  statusNote,
  statusChangedAt,
  statusChangedByName,
  monitorUntil,
  canMove,
}: {
  escalationId: string;
  organisationId: string;
  status: EscalationStatus;
  statusNote: string | null;
  statusChangedAt: string | null;
  statusChangedByName: string | null;
  monitorUntil: string | null;
  /** The assigned doctor or the CMO (the database enforces this; this only decides whether to draw the form). */
  canMove: boolean;
}) {
  const router = useRouter();
  const move = useMoveEscalationState();
  const changeDate = useChangeMonitoringDate();
  const firstOther = WORKING_ESCALATION_STATUSES.find((s) => s !== status) ?? "awaiting_information";
  const [target, setTarget] = useState<WorkingEscalationStatus>(firstOther);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const inWorkingState = isWorkingEscalationStatus(status);
  const pending = move.isPending || changeDate.isPending;
  const error = move.error ?? changeDate.error;

  function submitMove() {
    const monitorUntilIso = target === "monitoring" ? lagosInputToIso(until) : null;
    const found = workingStateProblem({
      status: target,
      note,
      previousNote: statusNote,
      monitorUntil: monitorUntilIso,
      now: new Date(),
    });
    setProblem(found);
    if (found) return;
    move.mutate(
      { escalationId, organisationId, status: target, note: note.trim(), monitorUntil: monitorUntilIso },
      {
        onSuccess: () => {
          setNote("");
          setUntil("");
          router.refresh();
        },
      },
    );
  }

  function submitDateChange() {
    const monitorUntilIso = lagosInputToIso(until);
    const found = workingStateProblem({
      status: "monitoring",
      note,
      previousNote: statusNote,
      monitorUntil: monitorUntilIso,
      now: new Date(),
    });
    setProblem(found);
    if (found || !monitorUntilIso) return;
    changeDate.mutate(
      { escalationId, note: note.trim(), monitorUntil: monitorUntilIso },
      {
        onSuccess: () => {
          setNote("");
          setUntil("");
          router.refresh();
        },
      },
    );
  }

  function backToReview() {
    setProblem(null);
    move.mutate(
      { escalationId, organisationId, status: "under_review", note: null, monitorUntil: null },
      { onSuccess: () => router.refresh() },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where this case stands</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm text-charcoal-ink">
          <p>
            <span className="font-medium">{ESCALATION_STATUS_LABEL[status]}</span>
            {status === "monitoring" && monitorUntil && <> until {formatLagos(monitorUntil)}</>}
          </p>
          {inWorkingState && statusNote && <p className="text-charcoal-ink/80">{statusNote}</p>}
          {statusChangedAt && (
            <p className="text-xs text-charcoal-ink/60">
              Last moved {formatLagos(statusChangedAt)}
              {statusChangedByName ? ` by ${statusChangedByName}` : " automatically"}
            </p>
          )}
          <p className="text-xs text-charcoal-ink/60">
            The contact deadline on the alert keeps running in every state.
          </p>
        </div>

        {canMove ? (
          <div className="space-y-3 border-t border-charcoal-ink/10 pt-4">
            <div className="space-y-2">
              <Label htmlFor="working-state">Move to</Label>
              <Select
                id="working-state"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value as WorkingEscalationStatus);
                  setProblem(null);
                }}
              >
                {WORKING_ESCALATION_STATUSES.filter((s) => s !== status).map((s) => (
                  <option key={s} value={s}>
                    {ESCALATION_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-charcoal-ink/60">{STATE_HELP[target]}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="working-state-note">Note (required)</Label>
              <Textarea
                id="working-state-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What you are waiting for, or why"
                maxLength={2000}
              />
            </div>
            {(target === "monitoring" || status === "monitoring") && (
              <div className="space-y-2">
                <Label htmlFor="working-state-until">Review by (Lagos time)</Label>
                <Input
                  id="working-state-until"
                  type="datetime-local"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </div>
            )}
            {(problem || error) && (
              <p className="text-sm text-red-600" role="alert">
                {problem ?? error?.message ?? "Could not save. Try again."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending} onClick={submitMove}>
                Move to {ESCALATION_STATUS_LABEL[target].toLowerCase()}
              </Button>
              {status === "monitoring" && (
                <Button variant="outline" disabled={pending} onClick={submitDateChange}>
                  Change review-by date only
                </Button>
              )}
              {inWorkingState && (
                <Button variant="outline" disabled={pending} onClick={backToReview}>
                  Back to under review
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-charcoal-ink/60">
            Only the doctor this case is assigned to, or the Chief Medical Officer, can move it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

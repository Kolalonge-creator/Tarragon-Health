"use client";

import { useEffect, useState } from "react";
import {
  useVideoConsultationDetail,
  useConsultationPrepBundle,
  useAppointmentForVideoConsultation,
  useSetVideoConsultationCallState,
  useConfirmConsultationIdentity,
  useConsultationSummary,
  usePublishConsultationSummary,
} from "@/lib/queries/consultation-video";
import { useAdvanceAppointmentStatus, useCancelAppointment } from "@/lib/queries/appointments";
import { usePatientEncounterNotes } from "@/lib/queries/encounter-notes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConsultationPatientSnapshot } from "./consultation-patient-snapshot";
import { ClinicalEncounterNotesSection } from "../../patients/[patientId]/clinical-encounter-notes-section";
import { OrderLabTestForm } from "../../patients/[patientId]/order-lab-test-form";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/** 68.5 consultation timer — a client-side tick against started_at, not a
 * separate stored duration; the source of truth (started_at/ended_at)
 * already lives on video_consultations. */
function ConsultationTimer({ startedAt, endedAt }: { startedAt: string | null; endedAt: string | null }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt, endedAt]);

  if (!startedAt) return null;
  return (
    <span className="font-mono text-sm text-charcoal-ink/70">
      {endedAt
        ? `Call length ${Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000)} min`
        : `⏱ ${formatElapsed(startedAt)}`}
    </span>
  );
}

function PublishSummarySection({
  patientId,
  consultationId,
}: {
  patientId: string;
  consultationId: string;
}) {
  const { data: notes } = usePatientEncounterNotes(patientId);
  const { data: existingSummary } = useConsultationSummary(consultationId);
  const publish = usePublishConsultationSummary();
  const [open, setOpen] = useState(false);
  const [whatWeDiscussed, setWhatWeDiscussed] = useState("");
  const [whatYouNeedToDo, setWhatYouNeedToDo] = useState("");
  const [medicinesNote, setMedicinesNote] = useState("");
  const [testsNote, setTestsNote] = useState("");
  const [nextAppointmentNote, setNextAppointmentNote] = useState("");

  const eligibleNote = notes?.find(
    (n) => n.video_consultation_id === consultationId && n.status === "finalized"
  );

  if (existingSummary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Patient summary</CardTitle>
          <CardDescription>Published. The patient can see this on their dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-charcoal-ink/80">
          <p>
            <span className="font-medium">What we discussed: </span>
            {existingSummary.what_we_discussed}
          </p>
          {existingSummary.what_you_need_to_do && (
            <p>
              <span className="font-medium">What you need to do: </span>
              {existingSummary.what_you_need_to_do}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!eligibleNote) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Patient summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            Sign and finalize a clinical note for this call above before publishing a summary for
            the patient.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">68.17: Publish a summary for the patient</CardTitle>
        <CardDescription>
          A short, plain-language recap, not the clinical note itself. The patient will see exactly
          what you write here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!open ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            Write summary
          </Button>
        ) : (
          <>
            <div>
              <Label>What we discussed</Label>
              <Textarea value={whatWeDiscussed} onChange={(e) => setWhatWeDiscussed(e.target.value)} />
            </div>
            <div>
              <Label>What you need to do</Label>
              <Textarea value={whatYouNeedToDo} onChange={(e) => setWhatYouNeedToDo(e.target.value)} />
            </div>
            <div>
              <Label>Medicines</Label>
              <Textarea value={medicinesNote} onChange={(e) => setMedicinesNote(e.target.value)} />
            </div>
            <div>
              <Label>Tests</Label>
              <Textarea value={testsNote} onChange={(e) => setTestsNote(e.target.value)} />
            </div>
            <div>
              <Label>Next appointment</Label>
              <Textarea value={nextAppointmentNote} onChange={(e) => setNextAppointmentNote(e.target.value)} />
            </div>
            {publish.isError && <p className="text-sm text-red-600">{(publish.error as Error).message}</p>}
            <Button
              size="sm"
              disabled={whatWeDiscussed.trim().length === 0 || publish.isPending}
              onClick={() =>
                publish.mutate({
                  clinicalEncounterNoteId: eligibleNote.id,
                  videoConsultationId: consultationId,
                  whatWeDiscussed: whatWeDiscussed.trim(),
                  whatYouNeedToDo: whatYouNeedToDo.trim() || undefined,
                  medicinesNote: medicinesNote.trim() || undefined,
                  testsNote: testsNote.trim() || undefined,
                  nextAppointmentNote: nextAppointmentNote.trim() || undefined,
                })
              }
            >
              {publish.isPending ? "Publishing…" : "Publish for patient"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_BADGE: Record<string, { label: string; tone: "amber" | "green" | "grey" | "blue" | "red" }> = {
  scheduled: { label: "Scheduled", tone: "grey" },
  started: { label: "In progress", tone: "green" },
  completed: { label: "Completed", tone: "blue" },
  cancelled: { label: "Cancelled", tone: "red" },
  no_show: { label: "No-show", tone: "amber" },
};

/**
 * 68.5/68.9/68.18 — the clinical consultation screen. Not a standalone
 * Zoom-like feature: video join, patient snapshot, structured notes,
 * prescribing, lab ordering, and referral (via the encounter note's
 * follow-up connector) all live on one page, embedded in the same care loop
 * as the rest of the patient's record.
 */
export function ConsultationScreen({
  consultationId,
  organisationId,
  patientId,
  patientName,
  patientNumber,
  isOrgStaff,
  canWriteNotes,
  canPrescribe,
}: {
  consultationId: string;
  organisationId: string;
  patientId: string;
  patientName: string;
  patientNumber: string | null;
  isOrgStaff: boolean;
  canWriteNotes: boolean;
  canPrescribe: boolean;
}) {
  const { data: consult, isLoading: consultLoading } = useVideoConsultationDetail(consultationId);
  const { data: bundle, isLoading: bundleLoading } = useConsultationPrepBundle(consultationId);
  const { data: appointment } = useAppointmentForVideoConsultation(consultationId);
  const callState = useSetVideoConsultationCallState();
  const confirmIdentity = useConfirmConsultationIdentity();
  const advanceAppointment = useAdvanceAppointmentStatus();
  const cancelAppointment = useCancelAppointment();
  const [error, setError] = useState<string | null>(null);

  if (consultLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (!consult) return <p className="text-sm text-charcoal-ink/60">Consultation not found.</p>;

  const status = STATUS_BADGE[consult.status] ?? { label: consult.status, tone: "grey" as const };
  const isJoinable = consult.status === "scheduled" || consult.status === "started";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>
                {patientName}
                {patientNumber ? ` (${patientNumber})` : ""}
              </CardTitle>
              <CardDescription>
                {consult.scheduled_at ? new Date(consult.scheduled_at).toLocaleString() : "Time to be confirmed"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <ConsultationTimer startedAt={consult.started_at} endedAt={consult.ended_at} />
              <Badge variant={status.tone}>{status.label}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {isJoinable && consult.host_start_url && (
            <Button asChild>
              <a href={consult.host_start_url} target="_blank" rel="noreferrer">
                Join as host
              </a>
            </Button>
          )}
          {isJoinable && !consult.host_start_url && (
            <p className="text-sm text-charcoal-ink/60">
              Setting up the video link. Refresh in a moment, or check that Zoom is configured.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {consult.status === "scheduled" && (
              <Button
                size="sm"
                variant="outline"
                disabled={callState.isPending}
                onClick={() =>
                  callState.mutate(
                    { consultationId, status: "started" },
                    { onError: (e) => setError((e as Error).message) }
                  )
                }
              >
                Start call
              </Button>
            )}
            {consult.status === "started" && (
              <Button
                size="sm"
                disabled={callState.isPending}
                onClick={() =>
                  callState.mutate(
                    { consultationId, status: "completed" },
                    { onError: (e) => setError((e as Error).message) }
                  )
                }
              >
                End call
              </Button>
            )}
            {isOrgStaff && (
              <Button
                size="sm"
                variant={consult.identity_verified_at ? "ghost" : "outline"}
                disabled={confirmIdentity.isPending || Boolean(consult.identity_verified_at)}
                onClick={() => confirmIdentity.mutate(consultationId, { onError: (e) => setError((e as Error).message) })}
              >
                {consult.identity_verified_at
                  ? `Identity confirmed ${new Date(consult.identity_verified_at).toLocaleTimeString()}`
                  : "Confirm patient identity"}
              </Button>
            )}
          </div>

          {isJoinable && (
            <div className="space-y-1 rounded-md border border-charcoal-ink/10 p-2.5">
              <p className="text-xs font-medium text-charcoal-ink/70">Poor connection?</p>
              <p className="text-xs text-charcoal-ink/60">
                Ask the patient to turn their camera off and continue on audio only. Zoom keeps
                the call running on a much lower-bandwidth connection that way. If audio also keeps
                dropping, end the call and use &ldquo;Technical failure&rdquo; below rather than
                leaving the appointment in progress with no outcome recorded.
              </p>
            </div>
          )}

          {appointment && ["booked", "confirmed", "checked_in", "in_progress"].includes(appointment.status) && (
            <div className="flex flex-wrap gap-2 border-t border-charcoal-ink/10 pt-3">
              <Button
                size="sm"
                variant="ghost"
                disabled={cancelAppointment.isPending}
                onClick={() =>
                  cancelAppointment.mutate(
                    { appointmentId: appointment.id, reason: "Technical failure during the video call" },
                    { onError: (e) => setError((e as Error).message) }
                  )
                }
              >
                Technical failure: end &amp; reschedule
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={advanceAppointment.isPending}
                onClick={() =>
                  advanceAppointment.mutate(
                    { appointmentId: appointment.id, to: "no_show", noShowReason: "patient_no_show" },
                    { onError: (e) => setError((e as Error).message) }
                  )
                }
              >
                Patient no-show
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={advanceAppointment.isPending}
                onClick={() =>
                  advanceAppointment.mutate(
                    { appointmentId: appointment.id, to: "no_show", noShowReason: "clinician_no_show" },
                    { onError: (e) => setError((e as Error).message) }
                  )
                }
              >
                Clinician no-show
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Patient snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          {bundleLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {bundle && <ConsultationPatientSnapshot bundle={bundle} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinical note for this call</CardTitle>
        </CardHeader>
        <CardContent>
          <ClinicalEncounterNotesSection
            patientId={patientId}
            organisationId={organisationId}
            canWrite={canWriteNotes}
            canActionFollowUps={isOrgStaff}
            defaultEncounterType="video_consult"
            videoConsultationId={consultationId}
            hideHeader
            patientName={patientName}
            patientDateOfBirth={null}
          />
        </CardContent>
      </Card>

      {isOrgStaff && <OrderLabTestForm patientId={patientId} organisationId={organisationId} />}

      {canPrescribe ? (
        <AddMedicationForm patientId={patientId} source="clinician" />
      ) : (
        isOrgStaff && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prescribing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-charcoal-ink/60">
                Your clinical tier can confirm/continue an existing prescription from the patient&apos;s
                chart, but starting a new medication needs Tier 2 or above.
              </p>
            </CardContent>
          </Card>
        )
      )}

      {canWriteNotes && <PublishSummarySection patientId={patientId} consultationId={consultationId} />}
    </div>
  );
}

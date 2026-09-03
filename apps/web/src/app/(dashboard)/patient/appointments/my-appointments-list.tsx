"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useMyUpcomingAppointments,
  useCancelAppointment,
  useConfirmAppointmentBooking,
  useMyWaitingListEntries,
  useCancelWaitingListEntry,
  useAcceptWaitingListOffer,
  useEnsureAppointmentVideoConsultation,
} from "@/lib/queries/appointments";
import { APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS } from "./appointment-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const JOINABLE_STATUSES = ["booked", "confirmed", "checked_in", "in_progress"];

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The patient's own upcoming appointments across every appointment_type,
 * plus any live waiting-list entries (10.17) — a cancellation elsewhere can
 * turn one of these into an "offered" slot the patient needs to accept. */
export function MyAppointmentsList({ patientId }: { patientId: string }) {
  const { data: appointments, isLoading } = useMyUpcomingAppointments(patientId);
  const { data: waitingList } = useMyWaitingListEntries(patientId);
  const cancel = useCancelAppointment();
  const confirm = useConfirmAppointmentBooking();
  const acceptOffer = useAcceptWaitingListOffer();
  const cancelWaitingListEntry = useCancelWaitingListEntry();
  const ensureVideo = useEnsureAppointmentVideoConsultation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleCancel(appointmentId: string) {
    setError(null);
    try {
      await cancel.mutateAsync({ appointmentId });
    } catch (e) {
      setError((e as Error).message || "Could not cancel that appointment.");
    }
  }

  /** 68.3/68.7 — routes into the same waiting-room page a booking under the
   * older video-visit-request flow uses, creating the Zoom meeting first if
   * this appointment doesn't have one yet. */
  async function handleJoinCall(appointmentId: string) {
    setError(null);
    try {
      const result = await ensureVideo.mutateAsync(appointmentId);
      router.push(`/patient/video-visit/${result.videoConsultationId}`);
    } catch (e) {
      setError((e as Error).message || "Could not open the video visit. Try again in a moment.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your upcoming appointments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {appointments && appointments.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No upcoming appointments yet.</p>
        )}
        {appointments && appointments.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {appointments.map((appt) => {
              const status = APPOINTMENT_STATUS_LABELS[appt.status] ?? { label: appt.status, tone: "grey" as const };
              return (
                <li key={appt.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div>
                    <p className="text-sm text-charcoal-ink">
                      {APPOINTMENT_TYPE_LABELS[appt.appointment_type] ?? appt.appointment_type},{" "}
                      {formatSlot(appt.scheduled_for)}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {appt.clinician?.full_name ?? "Care team"} ·{" "}
                      {appt.consultation_method === "telemedicine" ? "Telemedicine" : appt.location || "In person"}
                    </p>
                  </div>
                  <Badge variant={status.tone}>{status.label}</Badge>
                  <div className="ml-auto flex gap-2">
                    {appt.status === "held" && (
                      <Button size="sm" variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate(appt.id)}>
                        Confirm
                      </Button>
                    )}
                    {appt.consultation_method === "telemedicine" && JOINABLE_STATUSES.includes(appt.status) && (
                      <Button size="sm" disabled={ensureVideo.isPending} onClick={() => handleJoinCall(appt.id)}>
                        {ensureVideo.isPending ? "Opening…" : "Join call"}
                      </Button>
                    )}
                    {["held", "booked", "confirmed"].includes(appt.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancel.isPending}
                        onClick={() => handleCancel(appt.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {waitingList && waitingList.length > 0 && (
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-4">
            <p className="text-xs font-medium text-charcoal-ink/60">Waiting list</p>
            <ul className="divide-y divide-charcoal-ink/10">
              {waitingList.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div>
                    <p className="text-sm text-charcoal-ink">
                      {APPOINTMENT_TYPE_LABELS[entry.appointment_type] ?? entry.appointment_type}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {entry.status === "offered"
                        ? "A slot just opened up. Accept it before the offer expires."
                        : "Waiting for a slot to open."}
                    </p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    {entry.status === "offered" && (
                      <Button size="sm" disabled={acceptOffer.isPending} onClick={() => acceptOffer.mutate(entry.id)}>
                        Accept
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancelWaitingListEntry.isPending}
                      onClick={() => cancelWaitingListEntry.mutate(entry.id)}
                    >
                      Leave list
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

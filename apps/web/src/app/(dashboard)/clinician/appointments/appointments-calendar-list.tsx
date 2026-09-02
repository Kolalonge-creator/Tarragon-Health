"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useClinicianUpcomingAppointments,
  useAdvanceAppointmentStatus,
  useCancelAppointment,
  useEnsureAppointmentVideoConsultation,
} from "@/lib/queries/appointments";
import { APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS } from "@/app/(dashboard)/patient/appointments/appointment-labels";
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

/** 10.3 state machine surfaced for the clinician: check-in -> in progress ->
 * completed, or no-show. Cancelling here goes through cancel_appointment
 * (provider_cancelled), which also offers the freed slot to the waiting
 * list. */
export function AppointmentsCalendarList({ clinicianId }: { clinicianId: string }) {
  const { data: appointments, isLoading } = useClinicianUpcomingAppointments(clinicianId);
  const advance = useAdvanceAppointmentStatus();
  const cancel = useCancelAppointment();
  const ensureVideo = useEnsureAppointmentVideoConsultation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleAdvance(
    appointmentId: string,
    to: "checked_in" | "in_progress" | "completed" | "no_show",
    noShowReason?: "patient_no_show" | "clinician_no_show"
  ) {
    setError(null);
    try {
      await advance.mutateAsync({ appointmentId, to, noShowReason });
    } catch (e) {
      setError((e as Error).message || "Could not update that appointment.");
    }
  }

  async function handleCancel(appointmentId: string) {
    setError(null);
    try {
      await cancel.mutateAsync({ appointmentId });
    } catch (e) {
      setError((e as Error).message || "Could not cancel that appointment.");
    }
  }

  /** 68.5/68.9 — opens the clinician's own consultation screen (video +
   * patient snapshot + notes + prescribing + lab orders in one place),
   * creating the Zoom meeting first if this appointment doesn't have one
   * yet (e.g. the patient hasn't clicked "Join call" themselves). */
  async function handleStartVideoCall(appointmentId: string) {
    setError(null);
    try {
      const result = await ensureVideo.mutateAsync(appointmentId);
      router.push(`/clinician/video-visit/${result.videoConsultationId}`);
    } catch (e) {
      setError((e as Error).message || "Could not open the video visit — try again in a moment.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>My appointments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {appointments && appointments.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No upcoming appointments.</p>
        )}
        {appointments && appointments.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {appointments.map((appt) => {
              const status = APPOINTMENT_STATUS_LABELS[appt.status] ?? { label: appt.status, tone: "grey" as const };
              return (
                <li key={appt.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div>
                    <p className="text-sm text-charcoal-ink">
                      {APPOINTMENT_TYPE_LABELS[appt.appointment_type] ?? appt.appointment_type} —{" "}
                      {formatSlot(appt.scheduled_for)}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {appt.patient?.full_name ?? "Patient"}
                      {appt.patient?.patient_number ? ` (${appt.patient.patient_number})` : ""}
                    </p>
                  </div>
                  <Badge variant={status.tone}>{status.label}</Badge>
                  <div className="ml-auto flex flex-wrap justify-end gap-2">
                    {appt.consultation_method === "telemedicine" && JOINABLE_STATUSES.includes(appt.status) && (
                      <Button size="sm" disabled={ensureVideo.isPending} onClick={() => handleStartVideoCall(appt.id)}>
                        {ensureVideo.isPending ? "Opening…" : "Start video call"}
                      </Button>
                    )}
                    {["booked", "confirmed"].includes(appt.status) && (
                      <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => handleAdvance(appt.id, "checked_in")}>
                        Check in
                      </Button>
                    )}
                    {["checked_in", "confirmed"].includes(appt.status) && (
                      <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => handleAdvance(appt.id, "in_progress")}>
                        Start
                      </Button>
                    )}
                    {["in_progress", "checked_in", "confirmed", "booked"].includes(appt.status) && (
                      <Button size="sm" disabled={advance.isPending} onClick={() => handleAdvance(appt.id, "completed")}>
                        Complete
                      </Button>
                    )}
                    {/* 68.15 — patient/clinician no-show tracked separately; a
                        technical failure is a cancellation instead (see
                        Cancel below), never lumped in with either no-show. */}
                    {["booked", "confirmed", "checked_in"].includes(appt.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={advance.isPending}
                        onClick={() => handleAdvance(appt.id, "no_show", "patient_no_show")}
                      >
                        Patient no-show
                      </Button>
                    )}
                    {["booked", "confirmed", "checked_in"].includes(appt.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={advance.isPending}
                        onClick={() => handleAdvance(appt.id, "no_show", "clinician_no_show")}
                      >
                        Clinician no-show
                      </Button>
                    )}
                    {["held", "booked", "confirmed"].includes(appt.status) && (
                      <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => handleCancel(appt.id)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useAvailableAppointmentSlots, useRescheduleAppointment, type AppointmentType } from "@/lib/queries/appointments";
import { Button } from "@/components/ui/button";
import { formatPatientDateTime } from "@/lib/format-date";

const MAX_SHOWN = 12;

function formatSlot(iso: string): string {
  return formatPatientDateTime(iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * P15: move an appointment to another open time with the same clinician. reschedule_appointment keeps the clinician, carries a paid
 * visit's credit and consultation room to the new time, and refuses a time that is not open (slot_is_open) or was just taken, so this
 * only lists the clinician's open times from the same slot search booking uses. It never charges: a paid, confirmed visit stays
 * confirmed, and one still awaiting payment stays awaiting payment.
 */
export function RescheduleAppointment({
  appointment,
  patientId,
  openedAtMs,
  onDone,
  onClose,
}: {
  appointment: {
    id: string;
    organisation_id: string;
    clinician_id: string;
    appointment_type: string;
    scheduled_for: string;
  };
  patientId: string;
  openedAtMs: number;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const slots = useAvailableAppointmentSlots({
    organisationId: appointment.organisation_id,
    appointmentType: appointment.appointment_type as AppointmentType,
    clinicianId: appointment.clinician_id,
    patientId,
  });
  const reschedule = useRescheduleAppointment();
  const [error, setError] = useState<string | null>(null);

  const options = (slots.data ?? [])
    .filter(
      (s) =>
        s.clinician_id === appointment.clinician_id &&
        s.slot_start !== appointment.scheduled_for &&
        new Date(s.slot_start).getTime() > openedAtMs,
    )
    .slice(0, MAX_SHOWN);

  async function choose(slot: { slot_start: string; slot_end: string }) {
    setError(null);
    try {
      await reschedule.mutateAsync({ appointmentId: appointment.id, newScheduledFor: slot.slot_start, newEndsAt: slot.slot_end });
      onDone(`Moved to ${formatSlot(slot.slot_start)}.`);
    } catch (e) {
      setError((e as Error).message || "Could not move that appointment. Please pick another time.");
    }
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">Pick a new time with the same clinician</p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {slots.isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading open times…</p>}
      {slots.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t load open times. Please try again in a moment.
        </p>
      )}
      {slots.data && options.length === 0 && (
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          This clinician has no other open times right now. You can keep this appointment, or cancel it and book with someone else.
        </p>
      )}
      {options.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {options.map((slot) => (
            <li key={slot.slot_start}>
              <Button size="sm" variant="outline" disabled={reschedule.isPending} onClick={() => choose(slot)}>
                {formatSlot(slot.slot_start)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="ghost" onClick={onClose}>
        Keep the current time
      </Button>
    </div>
  );
}

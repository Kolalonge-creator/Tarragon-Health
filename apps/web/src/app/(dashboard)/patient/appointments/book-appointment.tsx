"use client";

import { useState } from "react";
import {
  useAvailableAppointmentSlots,
  useHoldAppointmentSlot,
  useConfirmAppointmentBooking,
  useJoinWaitingList,
  type AppointmentType,
} from "@/lib/queries/appointments";
import { APPOINTMENT_TYPE_LABELS } from "./appointment-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Patient-facing search + book flow (10.11): pick an appointment type,
 * see open slots over the next two weeks, and book one. Booking is
 * hold -> confirm in sequence — most appointment types here carry no direct
 * charge (payment_status defaults 'not_required'), so confirm resolves
 * straight to 'confirmed' with no separate payment step to wait on.
 */
export function BookAppointment({
  organisationId,
  patientId,
  initialAppointmentType,
}: {
  organisationId: string;
  patientId: string;
  /** Preselects the type picker — e.g. the Wellbeing page linking straight
   * into "Therapy session" rather than defaulting to GP. */
  initialAppointmentType?: AppointmentType;
}) {
  const [appointmentType, setAppointmentType] = useState<AppointmentType>(initialAppointmentType ?? "gp");
  const [consultationMethod, setConsultationMethod] = useState<"telemedicine" | "in_person" | "">("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const { data: slots, isLoading } = useAvailableAppointmentSlots({
    organisationId,
    appointmentType,
    consultationMethod: consultationMethod || undefined,
  });
  const hold = useHoldAppointmentSlot();
  const confirm = useConfirmAppointmentBooking();
  const joinWaitingList = useJoinWaitingList();

  const isBooking = hold.isPending || confirm.isPending;

  async function bookSlot(slot: {
    clinician_id: string;
    slot_start: string;
    slot_end: string;
    consultation_method: "telemedicine" | "in_person";
    location: string | null;
  }) {
    setMessage(null);
    try {
      const held = await hold.mutateAsync({
        organisationId,
        clinicianId: slot.clinician_id,
        appointmentType,
        consultationMethod: slot.consultation_method,
        scheduledFor: slot.slot_start,
        endsAt: slot.slot_end,
        location: slot.location ?? undefined,
      });
      await confirm.mutateAsync(held.id);
      setMessage({ tone: "success", text: `Booked for ${formatSlot(slot.slot_start)}.` });
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message || "Could not book that slot — try another." });
    }
  }

  async function handleJoinWaitingList() {
    setMessage(null);
    try {
      const now = new Date();
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await joinWaitingList.mutateAsync({
        organisationId,
        patientId,
        appointmentType,
        consultationMethod: consultationMethod || undefined,
        preferredFrom: now.toISOString(),
        preferredUntil: in30Days.toISOString(),
      });
      setMessage({ tone: "success", text: "You're on the waiting list — we'll notify you the moment a slot opens." });
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message || "Could not join the waiting list." });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book an appointment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <label className="text-xs text-charcoal-ink/60" htmlFor="appointment-type">
              Appointment type
            </label>
            <Select
              id="appointment-type"
              value={appointmentType}
              onChange={(e) => setAppointmentType(e.target.value as AppointmentType)}
            >
              {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-charcoal-ink/60" htmlFor="consultation-method">
              How
            </label>
            <Select
              id="consultation-method"
              value={consultationMethod}
              onChange={(e) => setConsultationMethod(e.target.value as "telemedicine" | "in_person" | "")}
            >
              <option value="">Any</option>
              <option value="telemedicine">Telemedicine</option>
              <option value="in_person">In person</option>
            </Select>
          </div>
        </div>

        {message && (
          <p className={`text-sm ${message.tone === "success" ? "text-brand-green" : "text-red-600"}`}>
            {message.text}
          </p>
        )}

        {isLoading && <p className="text-sm text-charcoal-ink/60">Looking for open times…</p>}

        {!isLoading && slots && slots.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/60">
              No open times in the next two weeks for this appointment type.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={joinWaitingList.isPending}
              onClick={handleJoinWaitingList}
            >
              {joinWaitingList.isPending ? "Joining…" : "Join the waiting list"}
            </Button>
          </div>
        )}

        {!isLoading && slots && slots.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {slots.slice(0, 20).map((slot) => (
              <li
                key={`${slot.clinician_id}-${slot.slot_start}`}
                className="flex flex-wrap items-center gap-2 py-2"
              >
                <div>
                  <p className="text-sm text-charcoal-ink">{formatSlot(slot.slot_start)}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {slot.clinician_name} · {slot.consultation_method === "telemedicine" ? "Telemedicine" : slot.location || "In person"}
                  </p>
                </div>
                <Button size="sm" className="ml-auto" disabled={isBooking} onClick={() => bookSlot(slot)}>
                  Book
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

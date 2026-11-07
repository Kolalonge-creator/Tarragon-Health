"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMyBookingTerms } from "@/lib/queries/appointments";
import { cancelOutcomeLines } from "@/lib/appointments/appointment-views";

export type CancellableAppointment = {
  id: string;
  appointment_type: string;
  consultation_method: string;
  payment_status: string;
  scheduled_for: string;
};

/**
 * P15: the confirmation step before cancel_appointment runs. It says what happens next (the time is freed, whether the visit credit
 * comes back) from the live booking terms. It never charges or refunds anything itself: the database decides, this only explains.
 * `openedAtMs` is read when the patient taps Cancel, so the late-cancel check matches the moment they chose to cancel.
 */
export function CancelAppointmentDialog({
  appointment,
  openedAtMs,
  slotLabel,
  pending,
  onConfirm,
  onClose,
}: {
  appointment: CancellableAppointment | null;
  openedAtMs: number;
  slotLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const terms = useMyBookingTerms(appointment?.appointment_type ?? "telemedicine");
  const lines = appointment
    ? cancelOutcomeLines({
        consultationMethod: appointment.consultation_method,
        paymentStatus: appointment.payment_status,
        scheduledFor: appointment.scheduled_for,
        nowMs: openedAtMs,
        terms: terms.data ?? null,
      })
    : [];
  return (
    <ConfirmDialog
      open={appointment !== null}
      title="Cancel this appointment?"
      description={slotLabel}
      confirmLabel={pending ? "Cancelling…" : "Yes, cancel it"}
      cancelLabel="Keep it"
      confirmDisabled={pending || (appointment !== null && terms.isLoading)}
      destructive
      onConfirm={onConfirm}
      onCancel={onClose}
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

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
  useMyUpcomingEncounters,
} from "@/lib/queries/appointments";
import {
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  PAID_APPOINTMENT_PRODUCT_CODE,
} from "./appointment-labels";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { BookingTermsCard } from "@/components/consultation/booking-terms";
import { IntakeForm } from "@/components/consultation/intake-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { joinOpensAt, joinWindowState } from "@/lib/consultation/join-window";
import { useHalfMinuteClock } from "@/lib/consultation/use-half-minute-clock";
import { Button } from "@/components/ui/button";
import { CALENDAR_APPOINTMENT_STATUSES } from "@/lib/calendar/ics";
import { ConsultationRuleCard } from "@/components/consultation/consultation-rule";
import type { Locale } from "@tarragon/i18n";
import { CHANGEABLE_STATUSES } from "@/lib/appointments/appointment-views";
import { CancelAppointmentDialog, type CancellableAppointment } from "./cancel-appointment-dialog";
import { RescheduleAppointment } from "./reschedule-appointment";

import { formatPatientDateTime } from "@/lib/format-date";
const JOINABLE_STATUSES = ["booked", "confirmed", "checked_in", "in_progress"];
/** A visit already under way stays joinable past the usual closing minute, so a dropped patient can always get back in. */
const UNDER_WAY_STATUSES = ["checked_in", "in_progress"];

function canJoinNow(status: string, scheduledFor: string, now: Date): boolean {
  const state = joinWindowState(scheduledFor, now);
  return state === "open" || (state === "closed" && UNDER_WAY_STATUSES.includes(status));
}

function formatSlot(iso: string): string {
  return formatPatientDateTime(iso, {
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
export function MyAppointmentsList({ patientId, locale = "en" }: { patientId: string; locale?: Locale }) {
  const { data: appointments, isLoading, isError } = useMyUpcomingAppointments(patientId);
  // S21: a booked consultation has its own room; an appointment without one (older bookings) keeps the older waiting room.
  const { data: encounters } = useMyUpcomingEncounters(patientId);
  const roomFor = (appointmentId: string) => encounters?.find((e) => e.appointment_id === appointmentId)?.encounter_id ?? null;
  const { data: waitingList } = useMyWaitingListEntries(patientId);
  const cancel = useCancelAppointment();
  const confirm = useConfirmAppointmentBooking();
  const acceptOffer = useAcceptWaitingListOffer();
  const cancelWaitingListEntry = useCancelWaitingListEntry();
  const ensureVideo = useEnsureAppointmentVideoConsultation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // P15: the appointment awaiting the "Cancel this appointment?" answer, and the moment Cancel was tapped (read in the click handler).
  const [cancelling, setCancelling] = useState<{ appt: CancellableAppointment; label: string; atMs: number } | null>(null);
  const [rescheduling, setRescheduling] = useState<{ id: string; atMs: number } | null>(null);
  // Re-check the join window every 30 seconds so "Join call" appears on time
  // without a reload. Null on the server and during hydration, so the button
  // shows only once the browser clock has been read.
  const clockMs = useHalfMinuteClock();
  const now = clockMs === null ? null : new Date(clockMs);

  /**
   * A paid appointment type (telemedicine/result_interpretation) with no
   * credit available at booking time is left at status 'booked', not
   * 'confirmed' — see book-appointment.tsx's own comment. That component's
   * "Pay to confirm" button only ever appeared for the rest of the same
   * browser session (pendingPaymentAppointment is local state, set right
   * after a bookSlot() call) — reload the page, or book from a different
   * device/session (e.g. the native app), and a 'booked'-awaiting-payment
   * appointment had NO way to pay at all, anywhere. Reuses the exact same
   * resume mechanism: book-appointment.tsx already watches for
   * ?resume_appointment=<id> on this page and auto-confirms once the
   * purchase succeeds.
   */
  async function payToConfirm(appointmentId: string, productCode: string) {
    setError(null);
    setPayingId(appointmentId);
    const result = await purchaseServiceProduct({
      serviceProductCode: productCode,
      callbackPath: `/patient/appointments?resume_appointment=${appointmentId}`,
    });
    if (result?.error) {
      setError(result.error);
      setPayingId(null);
      return;
    }
    if (result?.checkoutUrl) {
      window.location.href = result.checkoutUrl;
      return;
    }
    if (result?.activated) {
      router.replace(`/patient/appointments?resume_appointment=${appointmentId}`);
    }
  }

  async function handleCancel(appointmentId: string) {
    setError(null);
    setNotice(null);
    try {
      await cancel.mutateAsync({ appointmentId });
      setNotice("Appointment cancelled. You can see it under Cancelled.");
    } catch (e) {
      setError((e as Error).message || "Could not cancel that appointment.");
    } finally {
      setCancelling(null);
    }
  }

  /** 68.3/68.7 — routes into the same waiting-room page a booking under the
   * older video-visit-request flow uses, creating the Zoom meeting first if
   * this appointment doesn't have one yet. */
  async function handleJoinCall(appointmentId: string) {
    setError(null);
    const room = roomFor(appointmentId);
    if (room) {
      router.push(`/patient/consultation/${room}`);
      return;
    }
    try {
      const result = await ensureVideo.mutateAsync(appointmentId);
      router.push(`/patient/video-visit/${result.videoConsultationId}`);
    } catch (e) {
      setError((e as Error).message || "Could not open the video visit. Please try again in a moment.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your upcoming appointments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {notice && (
          <p role="status" className="text-sm text-charcoal-ink dark:text-night-ink">
            {notice}
          </p>
        )}

        {appointments?.some((a) => a.consultation_method === "telemedicine") && <ConsultationRuleCard locale={locale} />}
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Couldn&apos;t load your upcoming appointments. Please refresh the page to try again.
          </p>
        )}
        {appointments && appointments.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No upcoming appointments yet.</p>
        )}
        {appointments && appointments.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {appointments.map((appt) => {
              const status = APPOINTMENT_STATUS_LABELS[appt.status] ?? { label: appt.status.replace(/_/g, " "), tone: "grey" as const };
              return (
                <li key={appt.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div>
                    <p className="text-sm text-charcoal-ink dark:text-night-ink">
                      {APPOINTMENT_TYPE_LABELS[appt.appointment_type] ?? appt.appointment_type.replace(/_/g, " ")},{" "}
                      {formatSlot(appt.scheduled_for)}
                    </p>
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      {appt.clinician?.full_name ?? "Care team"} ·{" "}
                      {appt.consultation_method === "telemedicine" ? "Telemedicine" : appt.location || "In person"}
                    </p>
                    {appt.booked_via === "coordinator_phone" && (
                      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Booked for you by the care team, over the phone.</p>
                    )}
                  </div>
                  <Badge variant={status.tone}>{status.label}</Badge>
                  <div className="ml-auto flex gap-2">
                    {appt.status === "held" && (
                      <Button size="sm" variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate(appt.id)}>
                        Confirm
                      </Button>
                    )}
                    {appt.status === "booked" && PAID_APPOINTMENT_PRODUCT_CODE[appt.appointment_type] && (
                      <Button
                        size="sm"
                        disabled={payingId === appt.id}
                        onClick={() =>
                          payToConfirm(appt.id, PAID_APPOINTMENT_PRODUCT_CODE[appt.appointment_type]!)
                        }
                      >
                        {payingId === appt.id ? "Redirecting to payment…" : "Pay to confirm"}
                      </Button>
                    )}
                    {appt.consultation_method === "telemedicine" &&
                      JOINABLE_STATUSES.includes(appt.status) &&
                      now !== null &&
                      canJoinNow(appt.status, appt.scheduled_for, now) && (
                        <Button size="sm" disabled={ensureVideo.isPending} onClick={() => handleJoinCall(appt.id)}>
                          {ensureVideo.isPending ? "Opening…" : "Join call"}
                        </Button>
                      )}
                    {appt.consultation_method === "telemedicine" &&
                      JOINABLE_STATUSES.includes(appt.status) &&
                      now !== null &&
                      joinWindowState(appt.scheduled_for, now) === "too_early" && (
                        <span className="self-center text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                          You can join from {formatSlot(joinOpensAt(appt.scheduled_for).toISOString())}
                        </span>
                      )}
                    {(CALENDAR_APPOINTMENT_STATUSES as readonly string[]).includes(appt.status) && (
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/calendar/appointment/${appt.id}`}>Add to calendar</a>
                      </Button>
                    )}
                    {CHANGEABLE_STATUSES.includes(appt.status) && appt.clinician_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-expanded={rescheduling?.id === appt.id}
                        onClick={() => {
                          setNotice(null);
                          setRescheduling(rescheduling?.id === appt.id ? null : { id: appt.id, atMs: Date.now() });
                        }}
                      >
                        Reschedule
                      </Button>
                    )}
                    {CHANGEABLE_STATUSES.includes(appt.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancel.isPending}
                        onClick={() =>
                          setCancelling({
                            appt,
                            label: `${APPOINTMENT_TYPE_LABELS[appt.appointment_type] ?? appt.appointment_type.replace(/_/g, " ")}, ${formatSlot(appt.scheduled_for)}`,
                            atMs: Date.now(),
                          })
                        }
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  {rescheduling?.id === appt.id && appt.clinician_id && (
                    <RescheduleAppointment
                      appointment={{ ...appt, clinician_id: appt.clinician_id }}
                      patientId={patientId}
                      openedAtMs={rescheduling.atMs}
                      onDone={(message) => {
                        setRescheduling(null);
                        setNotice(message);
                      }}
                      onClose={() => setRescheduling(null)}
                    />
                  )}
                  {/* S64 (15.7): the price and cancel rule sit beside the pay button, so nobody pays without seeing them */}
                  {appt.status === "booked" && PAID_APPOINTMENT_PRODUCT_CODE[appt.appointment_type] && (
                    <div className="w-full">
                      <BookingTermsCard appointmentType={appt.appointment_type} />
                    </div>
                  )}
                  {/* S64 (15.3): the patient's own intake, for a consultation that has not happened yet */}
                  {appt.consultation_method === "telemedicine" && ["booked", "confirmed", "checked_in"].includes(appt.status) && (
                    <IntakeForm appointmentId={appt.id} />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {waitingList && waitingList.length > 0 && (
          <div className="space-y-2 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
            <p className="text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60">Waiting list</p>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {waitingList.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div>
                    <p className="text-sm text-charcoal-ink dark:text-night-ink">
                      {APPOINTMENT_TYPE_LABELS[entry.appointment_type] ?? entry.appointment_type.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      {entry.status === "offered"
                        ? "A time has become available. Please accept it before the offer expires."
                        : "Waiting for a time to become available."}
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
        <CancelAppointmentDialog
          appointment={cancelling?.appt ?? null}
          openedAtMs={cancelling?.atMs ?? 0}
          slotLabel={cancelling?.label ?? ""}
          pending={cancel.isPending}
          onConfirm={() => cancelling && handleCancel(cancelling.appt.id)}
          onClose={() => setCancelling(null)}
        />
      </CardContent>
    </Card>
  );
}

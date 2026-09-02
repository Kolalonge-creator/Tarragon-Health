"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAvailableAppointmentSlots,
  useHoldAppointmentSlot,
  useConfirmAppointmentBooking,
  useJoinWaitingList,
  type AppointmentType,
} from "@/lib/queries/appointments";
import { APPOINTMENT_TYPE_LABELS } from "./appointment-labels";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
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

/** Appointment types that carry a direct charge, satisfied by a pre-bought
 * single-use service_purchases credit — see the redemption logic inside
 * confirm_appointment_booking (20260831163838). Everything else stays free
 * (payment_status defaults 'not_required'). */
const PAID_APPOINTMENT_PRODUCT_CODE: Partial<Record<AppointmentType, string>> = {
  telemedicine: "video_visit_credit",
  result_interpretation: "result_interpretation_credit",
};

/**
 * Patient-facing search + book flow (10.11): pick an appointment type,
 * see open slots over the next two weeks, and book one. Booking is
 * hold -> confirm in sequence. For a free appointment type, confirm resolves
 * straight to 'confirmed'. For a paid type (video/audio visit, result
 * interpretation session) with no available credit yet, confirm instead
 * leaves the hold at 'booked' and this component offers to buy the credit —
 * checkout redirects back here with ?resume_appointment=<id>, which
 * re-confirms automatically once the purchase has gone through.
 */
export function BookAppointment({
  organisationId,
  patientId,
}: {
  organisationId: string;
  patientId: string;
}) {
  const router = useRouter();
  const [appointmentType, setAppointmentType] = useState<AppointmentType>("gp");
  const [consultationMethod, setConsultationMethod] = useState<"telemedicine" | "in_person" | "">("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pendingPaymentAppointment, setPendingPaymentAppointment] = useState<{
    id: string;
    productCode: string;
    slotStart: string;
  } | null>(null);
  const [isBuying, setIsBuying] = useState(false);

  const { data: slots, isLoading } = useAvailableAppointmentSlots({
    organisationId,
    appointmentType,
    consultationMethod: consultationMethod || undefined,
  });
  const hold = useHoldAppointmentSlot();
  const confirm = useConfirmAppointmentBooking();
  const joinWaitingList = useJoinWaitingList();

  const isBooking = hold.isPending || confirm.isPending;

  // Resume a booking left pending payment: checkout redirected back here
  // with ?resume_appointment=<id> once the credit purchase succeeded. Read
  // directly off window.location rather than useSearchParams() so this
  // component doesn't force the whole page into a Suspense boundary just
  // for a one-time redirect-back check.
  useEffect(() => {
    const resumeId = new URLSearchParams(window.location.search).get("resume_appointment");
    if (!resumeId) return;
    router.replace("/patient/appointments");
    confirm
      .mutateAsync(resumeId)
      .then((appt) => {
        setMessage(
          appt.status === "confirmed"
            ? { tone: "success", text: "Payment received — your visit is booked." }
            : { tone: "error", text: "Payment is still processing — check back in a moment." }
        );
      })
      .catch((error) => {
        setMessage({ tone: "error", text: (error as Error).message || "Could not confirm your booking." });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bookSlot(slot: {
    clinician_id: string;
    slot_start: string;
    slot_end: string;
    consultation_method: "telemedicine" | "in_person";
    location: string | null;
  }) {
    setMessage(null);
    setPendingPaymentAppointment(null);
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
      const confirmed = await confirm.mutateAsync(held.id);

      if (confirmed.status === "confirmed") {
        setMessage({ tone: "success", text: `Booked for ${formatSlot(slot.slot_start)}.` });
        return;
      }

      const productCode = PAID_APPOINTMENT_PRODUCT_CODE[appointmentType];
      if (confirmed.status === "booked" && productCode) {
        setPendingPaymentAppointment({ id: confirmed.id, productCode, slotStart: slot.slot_start });
        setMessage({
          tone: "success",
          text: `Time held for ${formatSlot(slot.slot_start)} — pay to confirm your booking.`,
        });
        return;
      }

      setMessage({ tone: "error", text: "Could not book that slot — try another." });
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message || "Could not book that slot — try another." });
    }
  }

  async function payForPendingAppointment() {
    if (!pendingPaymentAppointment) return;
    setIsBuying(true);
    setMessage(null);
    try {
      const result = await purchaseServiceProduct({
        serviceProductCode: pendingPaymentAppointment.productCode,
        callbackPath: `/patient/appointments?resume_appointment=${pendingPaymentAppointment.id}`,
      });
      if (result?.error) {
        setMessage({ tone: "error", text: result.error });
        setIsBuying(false);
        return;
      }
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      if (result?.activated) {
        // No charge to run (shouldn't happen for a priced credit, but stay
        // consistent with purchaseServiceProduct's own contract) — resume
        // immediately.
        router.replace(`/patient/appointments?resume_appointment=${pendingPaymentAppointment.id}`);
      }
    } finally {
      setIsBuying(false);
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

        {pendingPaymentAppointment && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-brand-green/30 bg-brand-green/5 p-3">
            <p className="text-sm text-charcoal-ink">
              Your slot for {formatSlot(pendingPaymentAppointment.slotStart)} is held — pay now to confirm it.
            </p>
            <Button size="sm" className="ml-auto" disabled={isBuying} onClick={payForPendingAppointment}>
              {isBuying ? "Redirecting to payment…" : "Pay to confirm"}
            </Button>
          </div>
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

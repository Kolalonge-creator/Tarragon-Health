"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useChronicEnrolments,
  useProgrammeScheduleOccurrences,
  useLinkChronicCheckinAppointment,
  type ChronicScheduleOccurrence,
} from "@/lib/queries/chronic-programmes";
import { useActiveChronicProgrammes } from "@/lib/queries/chronic-programmes";
import {
  useAvailableDoctorCheckinSlots,
  type DoctorCheckinSlot,
} from "@/lib/queries/chronic-programme-checkin-slots";
import { useHoldAppointmentSlot, useConfirmAppointmentBooking } from "@/lib/queries/appointments";
import { buyProgrammeDoctorSupportedAddon } from "./chronic-programme-actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const OCCURRENCE_LABEL: Record<ChronicScheduleOccurrence["occurrence_type"], string> = {
  lab_panel: "Lab panel",
  doctor_checkin: "Doctor check-in call",
  programme_end_review: "12-week review",
};

const STATUS_BADGE: Record<
  ChronicScheduleOccurrence["status"],
  { label: string; variant: "green" | "amber" | "red" | "grey" | "blue" }
> = {
  pending: { label: "Upcoming", variant: "blue" },
  completed: { label: "Done", variant: "green" },
  missed: { label: "Missed", variant: "red" },
  skipped: { label: "Skipped", variant: "grey" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Inline slot-picker for one doctor_checkin occurrence — same hold ->
 * confirm flow as apps/web/src/app/(dashboard)/patient/appointments/
 * book-appointment.tsx, narrowed to the pooled doctor-checkin search, then
 * linked back to the occurrence (RLS keeps appointment_id staff-only, so
 * the patient goes through link_chronic_checkin_appointment instead of a
 * direct update). */
function CheckinBooker({
  occurrence,
  organisationId,
  enrolmentId,
}: {
  occurrence: ChronicScheduleOccurrence;
  organisationId: string;
  enrolmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { data: slots, isLoading } = useAvailableDoctorCheckinSlots({
    organisationId,
    enabled: open,
  });
  const hold = useHoldAppointmentSlot();
  const confirm = useConfirmAppointmentBooking();
  const link = useLinkChronicCheckinAppointment();
  const isBooking = hold.isPending || confirm.isPending || link.isPending;

  async function bookSlot(slot: DoctorCheckinSlot) {
    setMessage(null);
    try {
      const held = await hold.mutateAsync({
        organisationId,
        clinicianId: slot.clinician_id,
        appointmentType: "follow_up",
        consultationMethod: "telemedicine",
        scheduledFor: slot.slot_start,
        endsAt: slot.slot_end,
        service: "12-week programme check-in",
        location: slot.location ?? undefined,
      });
      const confirmed = await confirm.mutateAsync(held.id);
      await link.mutateAsync({ occurrenceId: occurrence.id, appointmentId: confirmed.id, enrolmentId });
      setMessage({ tone: "success", text: `Booked for ${formatSlot(slot.slot_start)}.` });
      setOpen(false);
    } catch (error) {
      setMessage({
        tone: "error",
        text: (error as Error).message || "Could not book that slot. Try another.",
      });
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Book this call
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory/60 p-3">
      {message && (
        <p className={`text-xs ${message.tone === "success" ? "text-brand-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      {isLoading && <p className="text-xs text-charcoal-ink/60">Looking for open times…</p>}
      {!isLoading && slots && slots.length === 0 && (
        <p className="text-xs text-charcoal-ink/60">
          No open doctor times in the next two weeks. Check back shortly, or contact us if this
          call is due soon.
        </p>
      )}
      {!isLoading && slots && slots.length > 0 && (
        <ul className="max-h-56 divide-y divide-charcoal-ink/10 overflow-y-auto">
          {slots.slice(0, 20).map((slot) => (
            <li
              key={`${slot.clinician_id}-${slot.slot_start}`}
              className="flex flex-wrap items-center gap-2 py-1.5"
            >
              <div>
                <p className="text-xs text-charcoal-ink">{formatSlot(slot.slot_start)}</p>
                <p className="text-[11px] text-charcoal-ink/60">with {slot.clinician_name}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 px-2 text-xs"
                disabled={isBooking}
                onClick={() => bookSlot(slot)}
              >
                Book
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

function OccurrenceRow({
  occurrence,
  organisationId,
  enrolmentId,
}: {
  occurrence: ChronicScheduleOccurrence;
  organisationId: string;
  enrolmentId: string;
}) {
  const status = STATUS_BADGE[occurrence.status];
  const canBook =
    occurrence.occurrence_type === "doctor_checkin" &&
    occurrence.status === "pending" &&
    !occurrence.appointment_id;

  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-charcoal-ink/60">Week {occurrence.week_number}</span>
        <p className="text-sm text-charcoal-ink">{OCCURRENCE_LABEL[occurrence.occurrence_type]}</p>
        <Badge variant={status.variant}>{status.label}</Badge>
        {occurrence.status === "pending" && (
          <span className="text-xs text-charcoal-ink/50">Due {formatDate(occurrence.due_date)}</span>
        )}
        {occurrence.occurrence_type === "doctor_checkin" && occurrence.appointment_id && occurrence.status === "pending" && (
          <span className="text-xs text-brand-green">Booked</span>
        )}
      </div>
      {canBook && (
        <CheckinBooker occurrence={occurrence} organisationId={organisationId} enrolmentId={enrolmentId} />
      )}
    </li>
  );
}

function BuyDoctorSupportedAddon({ enrolmentId }: { enrolmentId: string }) {
  const action = buyProgrammeDoctorSupportedAddon.bind(null, enrolmentId);
  const [state, formAction, pending] = useActionState(action, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.message) router.refresh();
  }, [state?.message, router]);

  return (
    <div className="space-y-2 rounded-md border border-brand-green/20 bg-brand-green/5 p-3">
      <p className="text-sm font-medium text-charcoal-ink">Want a doctor on this with you?</p>
      <p className="text-xs text-charcoal-ink/70">
        Adds 3 check-in calls with whichever doctor has capacity that week, active dose
        adjustments, and doctor-suggested testing across your 12 weeks.
      </p>
      <form action={formAction}>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Starting…" : "Add doctor support"}
        </Button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.message && <p className="text-xs text-brand-green">{state.message}</p>}
    </div>
  );
}

function EnrolmentCard({
  enrolment,
  programmeName,
  organisationId,
}: {
  enrolment: { id: string; track: string; programme_started_at: string | null; programme_ends_at: string | null };
  programmeName: string;
  organisationId: string;
}) {
  const { data: occurrences, isLoading } = useProgrammeScheduleOccurrences(enrolment.id);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{programmeName}: 12-week programme</CardTitle>
          <Badge variant={enrolment.track === "doctor_supported" ? "green" : "grey"}>
            {enrolment.track === "doctor_supported" ? "Doctor-supported" : "Self-monitoring"}
          </Badge>
        </div>
        <CardDescription>
          {enrolment.programme_started_at && enrolment.programme_ends_at
            ? `${formatDate(enrolment.programme_started_at)} – ${formatDate(enrolment.programme_ends_at)}`
            : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading your schedule…</p>}
        {occurrences && occurrences.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {occurrences.map((occurrence) => (
              <OccurrenceRow
                key={occurrence.id}
                occurrence={occurrence}
                organisationId={organisationId}
                enrolmentId={enrolment.id}
              />
            ))}
          </ul>
        )}
        {enrolment.track === "self_monitoring" && (
          <BuyDoctorSupportedAddon enrolmentId={enrolment.id} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The patient's 12-week chronic-care programme(s) — self-monitoring shows
 * the system-guided schedule only; doctor-supported additionally lets the
 * patient book each pooled doctor check-in inline. Slots in
 * patient/(sections)/care/page.tsx alongside CarePlanDisplay, following the
 * same card-composition pattern as every other condition-specific card
 * there (ObesitySummary, PregnancyStatus, etc.) rather than a new route.
 */
export function ChronicProgrammeTimeline({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: enrolments, isLoading } = useChronicEnrolments(patientId);
  const { data: programmes } = useActiveChronicProgrammes();

  if (isLoading) return null;
  if (!enrolments || enrolments.length === 0) return null;

  const programmeName = (programmeId: string) =>
    programmes?.find((p) => p.id === programmeId)?.name ?? "Your condition";

  return (
    <>
      {enrolments.map((enrolment) => (
        <EnrolmentCard
          key={enrolment.id}
          enrolment={enrolment}
          programmeName={programmeName(enrolment.programme_id)}
          organisationId={organisationId}
        />
      ))}
    </>
  );
}

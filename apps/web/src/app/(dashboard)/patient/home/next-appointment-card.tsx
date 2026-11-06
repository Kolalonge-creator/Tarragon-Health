import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDateTime } from "@/lib/format-date";
import type { NextAppointment } from "@/lib/patient/home-overview";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from "@/app/(dashboard)/patient/appointments/appointment-labels";
import { HomeJoinLink } from "./home-join-link";

/**
 * The next appointment on Home (spec 4.7; PD-05). Date, time, who with, what kind, its status and what to do before it. The join
 * link appears only inside the join window (HomeJoinLink); before that the card says when joining opens. A failed read shows a
 * plain line instead of pretending there is no appointment.
 */
export function NextAppointmentCard({ appointment }: { appointment: NextAppointment | null | undefined }) {
  if (appointment === null) return null;

  if (appointment === undefined) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          We could not load your appointments just now.{" "}
          <Link href="/patient/appointments" className="font-medium underline">
            Open Appointments
          </Link>
        </CardContent>
      </Card>
    );
  }

  const type = APPOINTMENT_TYPE_LABELS[appointment.appointmentType] ?? appointment.appointmentType.replace(/_/g, " ");
  const status = APPOINTMENT_STATUS_LABELS[appointment.status]?.label ?? appointment.status.replace(/_/g, " ");
  const remote = appointment.consultationMethod === "telemedicine";

  return (
    <Card data-testid="next-appointment-card">
      <CardHeader>
        <CardTitle className="text-base">Your next appointment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="font-heading text-lg font-semibold tabular-nums">
            {formatPatientDateTime(appointment.scheduledFor, {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {type} with {appointment.clinicianName ?? "your care team"} · {remote ? "Video" : appointment.location || "In person"} · {status}
          </p>
        </div>
        {remote ? (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Before you join: find a quiet place with a good connection, and have your medicines and any recent readings to hand.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {remote ? <HomeJoinLink scheduledFor={appointment.scheduledFor} status={appointment.status} /> : null}
          <Link href="/patient/appointments" className="text-sm font-medium text-deep-forest underline dark:text-brand-green-bright">
            View appointment
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

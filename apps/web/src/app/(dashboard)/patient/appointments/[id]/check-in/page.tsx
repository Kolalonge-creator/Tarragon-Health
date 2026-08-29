import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { appointmentCheckInQrSvg } from "@/lib/appointments/qr-render";
import { APPOINTMENT_TYPE_LABELS } from "../../appointment-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckInNowButton } from "./check-in-now-button";

export const metadata: Metadata = {
  title: "Check in",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * 69.7 check-in — one of three ways in: show this QR at reception (a
 * barcode-scanner reader on their side reads the plain appointment id and
 * checks in through the facility queue page's "scan or enter code" field),
 * or tap Check in now below to do it yourself through the app. The QR
 * encodes the appointment id only, plain text, same "no PHI in the code
 * itself" posture as the emergency card's printed QR — RLS/the
 * advance_appointment_status RPC's own patient-or-staff check is what
 * actually authorises a check-in, not secrecy of the id.
 */
export default async function AppointmentCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const supabase = await createClient();
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, appointment_type, scheduled_for, status, facility:facilities(name), location")
    .eq("id", id)
    .eq("patient_id", user.id)
    .maybeSingle();

  if (!appointment) notFound();

  const qrSvg = await appointmentCheckInQrSvg(appointment.id);
  const when = new Date(appointment.scheduled_for).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {APPOINTMENT_TYPE_LABELS[appointment.appointment_type] ?? appointment.appointment_type} check-in
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-charcoal-ink/60">
            {when} · {appointment.facility?.name ?? appointment.location ?? "In person"}
          </p>

          <div className="flex justify-center rounded-md border border-charcoal-ink/10 bg-white p-4">
            {qrSvg ? (
              // Locally generated SVG from this server's own QR render — no user input reaches it.
              <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
            ) : (
              <p className="text-sm text-charcoal-ink/60">
                A QR code could not be generated — use Check in now below instead.
              </p>
            )}
          </div>

          <p className="text-center text-xs text-charcoal-ink/60">
            Show this to reception, or check in yourself right here.
          </p>

          <CheckInNowButton appointmentId={appointment.id} status={appointment.status} />
        </CardContent>
      </Card>
    </div>
  );
}

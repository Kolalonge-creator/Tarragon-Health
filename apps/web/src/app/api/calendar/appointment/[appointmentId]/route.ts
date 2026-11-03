import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildIcs, icsResponse } from "@/lib/calendar/ics";
import { appointmentRowSchema, appointmentToEvent, CALENDAR_APPOINTMENT_STATUSES } from "@/lib/calendar/bookings";

/** "Add to my calendar" for one booked consultation, read on the caller's own session (RLS); a held or cancelled slot 404s. */
export async function GET(request: Request, { params }: { params: Promise<{ appointmentId: string }> }): Promise<Response> {
  const { appointmentId } = await params;
  if (!z.string().uuid().safeParse(appointmentId).success) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data, error } = await supabase
    .from("appointments")
    .select("id, scheduled_for, ends_at, status, appointment_type, clinician:profiles!appointments_clinician_id_fkey(full_name)")
    .eq("id", appointmentId)
    .eq("patient_id", user.id)
    .in("status", [...CALENDAR_APPOINTMENT_STATUSES])
    .maybeSingle();
  if (error) return new Response("We could not read your appointment. Please try again.", { status: 503 });
  const row = appointmentRowSchema.safeParse(data);
  const event = row.success ? appointmentToEvent(row.data, new URL(request.url).origin) : null;
  if (!event) return new Response("Not found", { status: 404 });
  return icsResponse(buildIcs([event]), "tarragon-appointment.ics");
}

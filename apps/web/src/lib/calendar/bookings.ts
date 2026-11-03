import { z } from "zod";
import type { Database } from "@tarragon/shared";
import type { createClient } from "@/lib/supabase/server";
import { myBookingListSchema, type MyBooking } from "@/lib/testing-days/model";
import { APPOINTMENT_TYPE_LABELS } from "@/app/(dashboard)/patient/appointments/appointment-labels";
import { appointmentEvent, CALENDAR_APPOINTMENT_STATUSES, testingDayEvent, type CalendarEvent } from "./ics";

export { CALENDAR_APPOINTMENT_STATUSES };

/**
 * Reads the signed-in person's own bookings for a calendar file. Every read runs on their own session, so RLS and the
 * my_* functions decide what they can see; an id that is not theirs simply is not found.
 */
type Supabase = Awaited<ReturnType<typeof createClient>>;
type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];


export const appointmentRowSchema = z.object({
  id: z.string().uuid(),
  scheduled_for: z.string(),
  ends_at: z.string(),
  status: z.string(),
  appointment_type: z.string(),
  clinician: z.object({ full_name: z.string().nullable() }).nullable(),
});
export type CalendarAppointment = z.infer<typeof appointmentRowSchema>;

export function appointmentLabel(type: string): string {
  return APPOINTMENT_TYPE_LABELS[type] ?? "Appointment";
}

export async function readMyTestingBookings(supabase: Supabase): Promise<MyBooking[]> {
  const { data, error } = await supabase.rpc("my_testing_bookings");
  if (error) throw error;
  return myBookingListSchema.parse(data ?? []);
}

export async function readMyAppointments(
  supabase: Supabase,
  patientId: string,
  range: { from: string; to: string },
  statuses: readonly AppointmentStatus[] = CALENDAR_APPOINTMENT_STATUSES,
): Promise<CalendarAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, scheduled_for, ends_at, status, appointment_type, clinician:profiles!appointments_clinician_id_fkey(full_name)")
    .eq("patient_id", patientId)
    .in("status", [...statuses])
    .gte("scheduled_for", range.from)
    .lt("scheduled_for", range.to)
    .order("scheduled_for", { ascending: true });
  if (error) throw error;
  return z.array(appointmentRowSchema).parse(data ?? []);
}

/** Event statuses after which a place no longer belongs in a calendar (a cancelled day also releases its places). */
export const ENDED_EVENT_STATUSES = new Set(["cancelled", "completed"]);

export function testingBookingToEvent(b: MyBooking, appUrl: string): CalendarEvent | null {
  return b.state === "confirmed" && !ENDED_EVENT_STATUSES.has(b.event_status) ? testingDayEvent(b, appUrl) : null;
}

export function appointmentToEvent(a: CalendarAppointment, appUrl: string): CalendarEvent | null {
  return appointmentEvent(
    { id: a.id, scheduled_for: a.scheduled_for, ends_at: a.ends_at, label: appointmentLabel(a.appointment_type), clinicianName: a.clinician?.full_name },
    appUrl,
  );
}

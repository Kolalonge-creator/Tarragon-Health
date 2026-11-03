import { createClient } from "@/lib/supabase/server";
import { buildIcs, icsResponse, type CalendarEvent } from "@/lib/calendar/ics";
import { appointmentToEvent, readMyAppointments, readMyTestingBookings, testingBookingToEvent } from "@/lib/calendar/bookings";

/** Every coming booking (confirmed testing-day places and booked consultations, the next 12 months) in one calendar file. */
export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const origin = new URL(request.url).origin;
  const now = new Date();
  const yearAhead = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000);
  const today = now.toISOString().slice(0, 10);
  let events: CalendarEvent[];
  try {
    const [testing, appointments] = await Promise.all([
      readMyTestingBookings(supabase),
      readMyAppointments(supabase, user.id, { from: now.toISOString(), to: yearAhead.toISOString() }),
    ]);
    events = [
      ...testing.filter((b) => b.event_date >= today).map((b) => testingBookingToEvent(b, origin)),
      ...appointments.map((a) => appointmentToEvent(a, origin)),
    ].filter((e): e is CalendarEvent => e !== null);
  } catch {
    // Never hand back a half-empty file that looks complete.
    return new Response("We could not read your bookings. Please try again.", { status: 503 });
  }
  return icsResponse(buildIcs(events), "tarragon-bookings.ics");
}

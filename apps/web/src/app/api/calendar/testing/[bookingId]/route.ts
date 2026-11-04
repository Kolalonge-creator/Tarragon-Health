import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildIcs, icsResponse, requestAppOrigin } from "@/lib/calendar/ics";
import { readMyTestingBookings, testingBookingToEvent } from "@/lib/calendar/bookings";

/** "Add to my calendar" for one confirmed testing-day place. The caller's own session reads it, so another person's id 404s. */
export async function GET(request: Request, { params }: { params: Promise<{ bookingId: string }> }): Promise<Response> {
  const { bookingId } = await params;
  if (!z.string().uuid().safeParse(bookingId).success) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  let bookings;
  try {
    bookings = await readMyTestingBookings(supabase);
  } catch {
    return new Response("We could not read your booking. Please try again.", { status: 503 });
  }
  const booking = bookings.find((b) => b.booking_id === bookingId);
  const event = booking ? testingBookingToEvent(booking, requestAppOrigin(request)) : null;
  if (!event) return new Response("Not found", { status: 404 });
  return icsResponse(buildIcs([event]), "tarragon-testing-day.ics");
}

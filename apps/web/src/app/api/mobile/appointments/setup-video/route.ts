import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { setupAppointmentVideoMeeting } from "@/lib/appointments/confirm-with-video-setup";
import type { Tables } from "@tarragon/shared";

type Appointment = Tables<"appointments">;

/**
 * Gives a mobile-booked telemedicine/result-interpretation appointment its
 * Zoom join link right after booking, instead of waiting for the first
 * "Join call" tap. Can't just re-call confirm_appointment_booking the way
 * web's confirmAppointmentAndSetupVideo does: that RPC raises "appointment
 * is not on hold" on anything already confirmed (see its own definition —
 * it's built for a single confirm, not a repeatable one), and mobile's
 * bookAppointment() has already confirmed the slot itself via the same RPC
 * before calling this route. So this wraps only the Zoom-setup half
 * (setupAppointmentVideoMeeting), reading the appointment through this
 * caller's own RLS-scoped bearer client first — the same
 * patient_id/is_org_staff/can_read_clinical policy web's cookie session
 * relies on — so a caller can only trigger this for an appointment they can
 * actually read, then handing the row to the (service-role, Zoom-secret-
 * touching) setup function exactly as web does.
 */
const setupVideoSchema = z.object({
  appointmentId: z.string().uuid(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = setupVideoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const { data: appointment, error: readError } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", parsed.data.appointmentId)
    .maybeSingle();
  if (readError || !appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  await setupAppointmentVideoMeeting(appointment as Appointment);
  return NextResponse.json({ ok: true });
}

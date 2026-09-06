"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";

const appointmentIdSchema = z.string().uuid();

export type EnsureAppointmentVideoResult =
  | { error: string }
  | { videoConsultationId: string; joinUrl: string | null };

/**
 * Bridges a telemedicine appointment (Appointment Engine, System A) to a
 * real Zoom meeting. Booking a telemedicine appointment through
 * hold_appointment_slot/confirm_appointment_booking never created a
 * video_consultations row on its own — this closes that gap the first time
 * either the patient or the clinician actually needs to join
 * ("Join call"/"Join as host"), rather than at booking time, so a booking
 * made while Zoom happens to be misconfigured still succeeds.
 *
 * ensure_appointment_video_consultation (SQL, idempotent) creates/links the
 * video_consultations row; the Zoom API call itself has to happen here, not
 * in SQL, since it needs server credentials. Mirrors
 * selectVideoVisitAlternateSlot's pattern: the authenticated user's own
 * session does the RLS-scoped read, a service-role client does the
 * Zoom-field write (video_consultations stays staff/service-write-only —
 * the patient who triggered this is never granted a direct UPDATE).
 */
export async function ensureAppointmentVideoConsultation(
  appointmentId: string
): Promise<EnsureAppointmentVideoResult> {
  const parsed = appointmentIdSchema.safeParse(appointmentId);
  if (!parsed.success) {
    return { error: "Invalid appointment" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: consult, error: ensureError } = await supabase.rpc(
    "ensure_appointment_video_consultation",
    { p_appointment_id: parsed.data }
  );
  if (ensureError || !consult) {
    return { error: ensureError?.message ?? "Could not set up this video visit" };
  }

  if (consult.join_url) {
    return { videoConsultationId: consult.id, joinUrl: consult.join_url };
  }

  if (!isZoomConfigured()) {
    // Nothing to do yet — the row exists and will pick up a join link once
    // Zoom credentials are configured; the caller shows a "not ready yet"
    // state rather than an error.
    return { videoConsultationId: consult.id, joinUrl: null };
  }

  const meeting = await createMeeting({
    topic: "Tarragon Health: video appointment",
    startTime: consult.scheduled_at ?? undefined,
  });
  if (!meeting.ok) {
    return { videoConsultationId: consult.id, joinUrl: null };
  }

  const service = createServiceRoleClient();
  const { error: updateError } = await service
    .from("video_consultations")
    .update({
      zoom_meeting_id: meeting.data.meetingId,
      join_url: meeting.data.joinUrl,
      host_start_url: meeting.data.hostStartUrl,
    })
    .eq("id", consult.id);
  if (updateError) {
    return { videoConsultationId: consult.id, joinUrl: null };
  }

  return { videoConsultationId: consult.id, joinUrl: meeting.data.joinUrl };
}

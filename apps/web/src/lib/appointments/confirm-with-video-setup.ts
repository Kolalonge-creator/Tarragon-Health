"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";
import type { Tables } from "@tarragon/shared";

type Appointment = Tables<"appointments">;

/**
 * The Zoom-meeting setup step confirm_appointment_booking's SQL itself can't
 * do (an HTTP call) — pulled out so both confirmAppointmentAndSetupVideo
 * (first confirm + resume-after-payment, on the web) and the mobile
 * "setup-video" route (called right after a native booking confirms, since
 * the RPC itself refuses a second call once already confirmed — see that
 * route's own comment) can give an already-confirmed appointment a real
 * join link without either duplicating this logic or re-running the RPC.
 * A no-op if the appointment isn't a video-bearing type, isn't confirmed
 * yet, or already has a join_url.
 */
export async function setupAppointmentVideoMeeting(appointment: Appointment): Promise<void> {
  if (
    appointment.status !== "confirmed" ||
    !appointment.video_consultation_id ||
    !appointment.scheduled_for ||
    !isZoomConfigured()
  ) {
    return;
  }

  const service = createServiceRoleClient();
  const { data: consult } = await service
    .from("video_consultations")
    .select("id, join_url")
    .eq("id", appointment.video_consultation_id)
    .maybeSingle();

  if (consult && !consult.join_url) {
    const meeting = await createMeeting({
      topic: "Tarragon Health: Video visit",
      startTime: appointment.scheduled_for,
    });
    if (meeting.ok) {
      await service
        .from("video_consultations")
        .update({
          zoom_meeting_id: meeting.data.meetingId,
          join_url: meeting.data.joinUrl,
          host_start_url: meeting.data.hostStartUrl,
        })
        .eq("id", consult.id);
    }
  }
}

/**
 * Wraps confirm_appointment_booking with the video setup step above — same
 * two-step shape as selectVideoVisitAlternateSlot in video-visit-actions.ts.
 * Used for both the first confirm attempt and the resume-after-payment one,
 * so a video/result-interpretation session gets a real join link the moment
 * it's genuinely confirmed, regardless of which call path got it there.
 */
export async function confirmAppointmentAndSetupVideo(appointmentId: string): Promise<Appointment> {
  const parsed = z.string().uuid().safeParse(appointmentId);
  if (!parsed.success) {
    throw new Error("Invalid appointment");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_appointment_booking", {
    p_appointment_id: parsed.data,
  });
  if (error || !data) {
    throw new Error(error?.message ?? "Could not confirm this booking");
  }
  const appointment = data as Appointment;
  await setupAppointmentVideoMeeting(appointment);
  return appointment;
}

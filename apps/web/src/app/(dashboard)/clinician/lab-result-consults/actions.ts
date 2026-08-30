"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";
import { sendLabResultConsultBookedConfirmation } from "@/lib/notifications/lab-result-consult-confirmation";

export type LabResultConsultDecisionState = { error?: string; message?: string } | undefined;

/**
 * Doctor picks a date/time for a paid lab-result consult request and books
 * it — founder ask, 2026-08-30: "doctors should be able to get queue of the
 * request pending, then they can select time and date that they are free
 * for the consult and the video link can then be generated." Mirrors
 * acceptVideoVisit (clinician/availability/actions.ts) exactly in shape and
 * error handling: the atomic booking (authority check, double-booking
 * guard, video_consultations row creation, forge-proof accepted_by
 * stamping) lives in the accept_lab_result_consult_request RPC, which runs
 * under the caller's own session — a non-clinician, a Care Coordinator, or
 * a different org's clinician gets a structural 42501, and an overlapping
 * time for the same doctor gets a plain rejection. This action then
 * attaches the Zoom meeting best-effort and tells the patient (notification
 * layer only) — the booking itself does not depend on Zoom being
 * configured or the notification succeeding.
 */
export async function acceptLabResultConsultRequest(
  _prev: LabResultConsultDecisionState,
  formData: FormData,
): Promise<LabResultConsultDecisionState> {
  const requestId = z.string().uuid().safeParse(String(formData.get("request_id") ?? ""));
  if (!requestId.success) return { error: "Invalid request" };

  const scheduledAtLocal = String(formData.get("scheduled_at") ?? "");
  const parsedDate = new Date(scheduledAtLocal);
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: "Pick a valid date and time" };
  }
  const scheduledAtIso = parsedDate.toISOString();

  const supabase = await createClient();
  const { data: consultId, error } = await supabase.rpc("accept_lab_result_consult_request", {
    p_request_id: requestId.data,
    p_scheduled_at: scheduledAtIso,
  });
  if (error || !consultId) {
    return { error: error?.message ?? "Could not book this consult." };
  }

  const { data: consult } = await supabase
    .from("video_consultations")
    .select("id, organisation_id, patient_id, scheduled_at")
    .eq("id", consultId)
    .maybeSingle();

  const service = createServiceRoleClient();
  let joinUrl: string | null = null;
  if (consult?.scheduled_at && isZoomConfigured()) {
    const meeting = await createMeeting({
      topic: "Tarragon Health: Lab-result consultation",
      startTime: consult.scheduled_at,
    });
    if (meeting.ok) {
      joinUrl = meeting.data.joinUrl;
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
  if (consult) {
    await sendLabResultConsultBookedConfirmation({ service, consultId: consult.id, joinUrl });
  }

  return { message: "Booked: the visit is scheduled and the patient has been told." };
}

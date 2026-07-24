"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";

export type VideoVisitDecisionState = { error?: string; message?: string } | undefined;

/**
 * Doctor accepts a paid video-visit request. The atomic booking (slot flip +
 * consult creation + forge-proof accepted_by stamping) lives in the
 * accept_video_visit_request RPC, which runs under the caller's own session —
 * a non-doctor gets a structural 42501. This action then attaches the Zoom
 * meeting best-effort and tells the patient (notification layer only). Only
 * on acceptance does the held payment stand.
 */
export async function acceptVideoVisit(
  _prev: VideoVisitDecisionState,
  formData: FormData
): Promise<VideoVisitDecisionState> {
  const parsed = z.string().uuid().safeParse(String(formData.get("request_id") ?? ""));
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const { data: consultId, error } = await supabase.rpc("accept_video_visit_request", {
    p_request_id: parsed.data,
  });
  if (error || !consultId) {
    return { error: error?.message ?? "Could not accept this request." };
  }

  const { data: consult } = await supabase
    .from("video_consultations")
    .select("id, organisation_id, patient_id, scheduled_at")
    .eq("id", consultId)
    .maybeSingle();

  const service = createServiceRoleClient();
  if (consult?.scheduled_at && isZoomConfigured()) {
    const meeting = await createMeeting({
      topic: "Tarragon Health — video visit",
      startTime: consult.scheduled_at,
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
  if (consult) {
    await service.from("notifications").insert({
      organisation_id: consult.organisation_id,
      recipient_id: consult.patient_id,
      channel: "whatsapp",
      status: "pending",
      template: "video_consult_booked",
      payload: { scheduled_at: consult.scheduled_at },
    });
  }

  return { message: "Accepted — the visit is booked and the patient has been told." };
}

/**
 * Doctor declines a paid request — the RPC flags the payment for a full
 * refund (processed by the refund cron), and the patient is notified with
 * the reason. Same doctor-tier structural gate as acceptance.
 */
export async function declineVideoVisit(
  _prev: VideoVisitDecisionState,
  formData: FormData
): Promise<VideoVisitDecisionState> {
  const requestId = z.string().uuid().safeParse(String(formData.get("request_id") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requestId.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_video_visit_request", {
    p_request_id: requestId.data,
    p_reason: reason,
  });
  if (error) {
    return { error: error.message };
  }

  const { data: request } = await supabase
    .from("video_visit_requests")
    .select("organisation_id, patient_id")
    .eq("id", requestId.data)
    .maybeSingle();
  if (request) {
    const service = createServiceRoleClient();
    await service.from("notifications").insert({
      organisation_id: request.organisation_id,
      recipient_id: request.patient_id,
      channel: "whatsapp",
      status: "pending",
      template: "video_visit_declined",
      payload: { reason: reason || null },
    });
  }

  return { message: "Declined — the patient will be refunded in full." };
}

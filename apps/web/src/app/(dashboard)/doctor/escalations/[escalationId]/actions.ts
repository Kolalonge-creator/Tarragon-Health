"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";
import { sendPatientLinkSms } from "@/lib/notifications/send-patient-link";

const escalationIdSchema = z.string().uuid();

export type StartVirtualReviewState =
  | { error: string }
  | { success: true; hostStartUrl: string; patientNotified: boolean }
  | undefined;

/**
 * Starts a Zoom pre-referral triage call (docs/Tarragon_Health_Master_Operating_Plan_v4.md
 * §7 Level 4: a short virtual consult to rule out a benign explanation
 * before deciding whether to refer at all) — doctor <-> patient, tied to
 * this escalation. Creates the video_consultations row first (so nothing
 * is lost if the Zoom call fails), then the real Zoom meeting, then
 * delivers the patient's own join link via SMS (Termii only for now — no
 * approved WhatsApp template exists yet for a video-call link, see
 * lib/notifications/send-patient-link.ts). The doctor's host_start_url is
 * returned directly rather than sent anywhere, since they're the one who
 * just clicked the button.
 */
export async function startVirtualReview(escalationId: string): Promise<StartVirtualReviewState> {
  const parsedId = escalationIdSchema.safeParse(escalationId);
  if (!parsedId.success) {
    return { error: "Invalid escalation" };
  }

  if (!isZoomConfigured()) {
    return { error: "Video consultations are not configured yet" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  // RLS (private.is_org_staff) is the real gate here, same as the rest of
  // this page — an escalation outside the caller's org simply doesn't come back.
  const { data: escalation } = await supabase
    .from("escalations")
    .select("id, organisation_id, patient_id, patient:profiles!escalations_patient_id_fkey(full_name, phone)")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!escalation) {
    return { error: "Escalation not found or not in your organisation" };
  }

  const { data: consultation, error: insertError } = await supabase
    .from("video_consultations")
    .insert({
      organisation_id: escalation.organisation_id,
      patient_id: escalation.patient_id,
      context: "pre_referral_triage",
      escalation_id: escalation.id,
      initiated_by: user.id,
    })
    .select("id")
    .single();
  if (insertError || !consultation) {
    return { error: insertError?.message ?? "Could not create the video consultation record" };
  }

  const meetingResult = await createMeeting({
    topic: `Tarragon Health — virtual review with ${escalation.patient?.full_name ?? "patient"}`,
  });
  if (!meetingResult.ok) {
    await supabase.from("video_consultations").update({ status: "cancelled" }).eq("id", consultation.id);
    return { error: meetingResult.error };
  }

  const { error: updateError } = await supabase
    .from("video_consultations")
    .update({
      zoom_meeting_id: meetingResult.data.meetingId,
      join_url: meetingResult.data.joinUrl,
      host_start_url: meetingResult.data.hostStartUrl,
    })
    .eq("id", consultation.id);
  if (updateError) {
    return { error: updateError.message };
  }

  let patientNotified = false;
  if (escalation.patient?.phone) {
    const smsResult = await sendPatientLinkSms(
      escalation.patient.phone,
      `Your Tarragon doctor would like a quick video call. Join here: ${meetingResult.data.joinUrl}`
    );
    patientNotified = smsResult.ok;
  }

  return { success: true, hostStartUrl: meetingResult.data.hostStartUrl, patientNotified };
}

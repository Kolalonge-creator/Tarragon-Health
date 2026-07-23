"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";

const bookSchema = z.object({ slotId: z.string().uuid() });

export type BookVideoVisitState =
  | { error: string }
  | { success: true; scheduledAt: string; hasLink: boolean }
  | undefined;

/**
 * Patient books an open video-visit slot. The atomic slot-flip + consult
 * creation happens inside public.book_video_consult_slot (security definer,
 * row-locked — no double booking); this action then attaches a scheduled Zoom
 * meeting best-effort and enqueues a confirmation reminder, exactly like
 * confirmAnnualReviewSlot. WhatsApp/SMS only reminds — the booking itself is
 * complete without any send.
 */
export async function bookVideoVisit(slotId: string): Promise<BookVideoVisitState> {
  const parsed = bookSchema.safeParse({ slotId });
  if (!parsed.success) {
    return { error: "Invalid slot" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: consultId, error } = await supabase.rpc("book_video_consult_slot", {
    p_slot_id: parsed.data.slotId,
  });
  if (error || !consultId) {
    return { error: error?.message ?? "Could not book that time" };
  }

  const { data: consult } = await supabase
    .from("video_consultations")
    .select("id, organisation_id, patient_id, scheduled_at")
    .eq("id", consultId)
    .maybeSingle();
  if (!consult?.scheduled_at) {
    return { error: "Booked, but could not load the confirmation — refresh to see it." };
  }

  const service = createServiceRoleClient();
  let hasLink = false;
  if (isZoomConfigured()) {
    const meeting = await createMeeting({
      topic: "Tarragon Health — video check-in",
      startTime: consult.scheduled_at,
    });
    if (meeting.ok) {
      hasLink = true;
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

  await service.from("notifications").insert({
    organisation_id: consult.organisation_id,
    recipient_id: consult.patient_id,
    channel: "whatsapp",
    status: "pending",
    template: "video_consult_booked",
    payload: { scheduled_at: consult.scheduled_at },
  });

  return { success: true, scheduledAt: consult.scheduled_at, hasLink };
}

"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";
import { sendVideoConsultBookedConfirmation } from "@/lib/notifications/video-consult-confirmation";

export type ConfirmHealthCheckVideoConsultState = { error: string } | { success: true } | undefined;

const schema = z.object({
  consultId: z.string().uuid(),
  slot: z.string().datetime(),
});

/**
 * Patient confirms one of the doctor's offered Health Check video-consult
 * times (every Screen tier since 20260829140114_health_check_video_consult_
 * all_tiers.sql). public.confirm_health_check_video_slot does the atomic
 * ownership + offered-slot validation (patients have no UPDATE grant on
 * video_consultations at all, see 20260716110000_video_consultations.sql);
 * this wrapper only adds the side effects that must happen outside Postgres
 * — the Zoom meeting and the booked-confirmation notification — mirroring
 * selectVideoVisitAlternateSlot in video-visit-actions.ts.
 */
export async function confirmHealthCheckVideoConsultSlot(
  consultId: string,
  slot: string
): Promise<ConfirmHealthCheckVideoConsultState> {
  const parsed = schema.safeParse({ consultId, slot });
  if (!parsed.success) {
    return { error: "Pick a time first" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_health_check_video_slot", {
    p_consultation_id: parsed.data.consultId,
    p_slot: parsed.data.slot,
  });
  if (error) return { error: error.message };

  const service = createServiceRoleClient();
  let joinUrl: string | null = null;
  if (isZoomConfigured()) {
    const meeting = await createMeeting({
      topic: "Tarragon Health: Annual Health Check video consult",
      startTime: parsed.data.slot,
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
        .eq("id", parsed.data.consultId);
    }
  }
  await sendVideoConsultBookedConfirmation({ service, consultId: parsed.data.consultId, joinUrl });

  return { success: true };
}

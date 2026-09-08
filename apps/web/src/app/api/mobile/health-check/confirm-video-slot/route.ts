import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";
import { sendVideoConsultBookedConfirmation } from "@/lib/notifications/video-consult-confirmation";

/**
 * Mobile equivalent of apps/web/.../patient/health-check-video-consult-actions.ts's
 * confirmHealthCheckVideoConsultSlot. public.confirm_health_check_video_slot
 * alone is a safe direct RPC (SECURITY DEFINER, ownership + offered-slot
 * validation), but the real action wraps more: creating a real Zoom meeting
 * and writing zoom_meeting_id/join_url/host_start_url via a service-role
 * client, then a booked-confirmation notification. None of that is possible
 * from an RLS-scoped mobile client, which is the one reason this route
 * exists at all — a thin, verbatim wrapper, not a reimplementation.
 */
const bodySchema = z.object({
  consultId: z.string().uuid(),
  slot: z.string().datetime(),
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a time first" }, { status: 400 });
  }

  const { error } = await supabase.rpc("confirm_health_check_video_slot", {
    p_consultation_id: parsed.data.consultId,
    p_slot: parsed.data.slot,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

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

  return NextResponse.json({ success: true });
}

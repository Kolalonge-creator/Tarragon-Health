import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";
import { sendVideoConsultBookedConfirmation } from "@/lib/notifications/video-consult-confirmation";

/**
 * Mobile equivalent of apps/web/.../patient/video-visit-actions.ts's
 * selectVideoVisitAlternateSlot. public.select_video_visit_alternate_slot
 * alone is a safe direct RPC (SECURITY DEFINER, ownership + offered-slot
 * validation, and — since 20260917230403_video_visit_platform_credit_spend_
 * on_acceptance.sql — the platform-credit spend for a credit-funded
 * request), but the real action wraps more: creating a real Zoom meeting and
 * writing zoom_meeting_id/join_url/host_start_url via a service-role client,
 * then a booked-confirmation notification. None of that is reachable from an
 * RLS-scoped mobile client, which is the one reason this route exists at all
 * — a thin, verbatim wrapper, not a reimplementation. Mirrors
 * apps/web/src/app/api/mobile/health-check/confirm-video-slot/route.ts's
 * shape exactly.
 */
const bodySchema = z.object({
  requestId: z.string().uuid(),
  slotId: z.string().uuid(),
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

  const { data: consultId, error } = await supabase.rpc("select_video_visit_alternate_slot", {
    p_request_id: parsed.data.requestId,
    p_slot_id: parsed.data.slotId,
  });
  if (error || !consultId) {
    return NextResponse.json({ error: error?.message ?? "Could not book that time." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data: consult } = await service
    .from("video_consultations")
    .select("id, scheduled_at")
    .eq("id", consultId)
    .maybeSingle();

  let joinUrl: string | null = null;
  if (consult?.scheduled_at && isZoomConfigured()) {
    const meeting = await createMeeting({
      topic: "Tarragon Health: Video visit",
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
        .eq("id", consultId);
    }
  }
  if (consult) {
    await sendVideoConsultBookedConfirmation({ service, consultId: consult.id, joinUrl });
  }

  return NextResponse.json({ success: true, consultationId: consultId as string });
}

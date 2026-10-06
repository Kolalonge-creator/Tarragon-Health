import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { handleVideoWebhook } from "@/lib/consultations/presence";
import { participantKeySecret } from "@/lib/consultations/call-config";
import { videoProvider } from "@/lib/consultations/providers";
import type { RpcClient } from "@/lib/consultations/room";

/**
 * Consultation presence from Zoom's participant events (S21 follow-up, OQ-160). Zoom allows ONE subscription URL per app, and that is the
 * `zoom-webhook` edge function: it forwards `meeting.participant_joined`, `..._joined_waiting_room` and `..._left` here unchanged (see
 * forwardPresenceEvent), and this route verifies the signature itself. Pointing the subscription straight at this route also works
 * (it answers the one-time challenge) but then meeting started and ended for the older visit flow would not be handled, so do not.
 * All the decisions live in lib/consultations/presence.ts; this is the wrapper.
 *
 * The body is read as raw text: Zoom signs the exact bytes it sent, so re-serialised JSON would not verify. Nothing here is
 * reachable without a valid Zoom signature (except the one-time URL challenge, which only echoes an HMAC under our own secret).
 * No name, key or event body is ever logged, only encounter ids and error codes.
 */
export const dynamic = "force-dynamic";

/** The one lookup this route makes. The generated database types predate the S21 tables, so the call is typed by hand. */
interface RoomTable {
  from(table: "encounter_rooms"): {
    select(columns: "encounter_id"): {
      eq(column: "provider", value: "zoom"): {
        eq(column: "provider_room_id", value: string): PromiseLike<never> & { maybeSingle(): PromiseLike<{ data: { encounter_id: string } | null; error: { message: string } | null }> };
      };
    };
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const video = videoProvider();
  if (!video.ok) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const service = createServiceRoleClient();

  const result = await handleVideoWebhook(
    {
      video: video.data,
      serviceRpc: service as unknown as RpcClient,
      encounterForRoom: async (roomId) => {
        const { data, error } = await (service as unknown as RoomTable).from("encounter_rooms").select("encounter_id").eq("provider", "zoom").eq("provider_room_id", roomId).maybeSingle();
        if (error) return "error";
        return data ? { encounterId: data.encounter_id } : null;
      },
      participantKeySecret: participantKeySecret(),
      webhookSecretToken: process.env.ZOOM_WEBHOOK_SECRET_TOKEN || null,
      now: () => Date.now(),
      log: (message) => console.error(message),
    },
    rawBody,
    {
      "x-zm-request-timestamp": request.headers.get("x-zm-request-timestamp"),
      "x-zm-signature": request.headers.get("x-zm-signature"),
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}

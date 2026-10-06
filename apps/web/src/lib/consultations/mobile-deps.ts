import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { videoProvider } from "./providers";
import type { RoomDeps, RpcClient } from "./room";

/**
 * S21 follow-up (OQ-158): the shared first step of the mobile consultation routes. Checks the bearer token, then builds the same
 * RoomDeps the web actions build, so room.ts (the one place vendor and window logic lives) is reused as is. The signed-in person's
 * own session is `userRpc`, so the database still sees auth.uid() (INV-12); the service client is only reached after room.ts has
 * checked that person against the encounter. Never logs the token, a link, a number or a vendor message.
 */
export async function mobileRoomDeps(request: Request): Promise<RoomDeps | NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  const video = videoProvider();
  // The reason is a code the app maps to its own wording; never a vendor message.
  if (!video.ok) return NextResponse.json({ ok: false, reason: "provider" }, { status: 503 });

  return {
    userId: user.id,
    userRpc: supabase as unknown as RpcClient,
    serviceRpc: createServiceRoleClient() as unknown as RpcClient,
    video: video.data,
    now: () => Date.now(),
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

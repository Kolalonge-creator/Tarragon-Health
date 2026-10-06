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

/**
 * The mobile room is the patient's. room.ts takes the role from the consultation itself (so the web action serves both people), so
 * these routes check, as the signed-in person, that they are the PATIENT on it before anything is issued. consultation_room_view
 * answers null for a stranger and an unknown id alike, so a refusal here reveals nothing about whether a consultation exists.
 */
export async function isPatientOnConsultation(deps: RoomDeps, encounterId: string): Promise<"yes" | "no" | "error"> {
  const res = await deps.userRpc.rpc("consultation_room_view", { p_encounter: encounterId });
  // A failed check is not a refusal: the routes answer it with a 500 so the app treats it as worth trying again.
  if (res.error) return "error";
  return (res.data as { role?: string } | null)?.role === "patient" ? "yes" : "no";
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

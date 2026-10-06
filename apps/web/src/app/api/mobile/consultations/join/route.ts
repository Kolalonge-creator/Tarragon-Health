import { NextResponse } from "next/server";
import { z } from "zod";
import { joinConsultation } from "@/lib/consultations/room";
import { isPatientOnConsultation, mobileRoomDeps, readJson } from "@/lib/consultations/mobile-deps";

/**
 * Mobile consultation room (OQ-158): issues the signed-in patient's own join link for one consultation. Same function the web
 * room calls (joinConsultation), so the join window, the "audio only once dropped" rule and the server-side join record are the
 * same. The link is returned once and never stored or logged. Patients only: the signed-in person must be the patient on the
 * consultation (checked here, since room.ts serves both people), and a clinician's room stays on the web.
 */
const bodySchema = z.object({
  encounterId: z.string().uuid(),
  media: z.enum(["video", "audio_only"]),
});

export async function POST(request: Request): Promise<NextResponse> {
  const deps = await mobileRoomDeps(request);
  if (deps instanceof NextResponse) return deps;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const patient = await isPatientOnConsultation(deps, parsed.data.encounterId);
  if (patient === "error") return NextResponse.json({ ok: false, reason: "provider" }, { status: 500 });
  if (patient === "no") return NextResponse.json({ ok: false, reason: "not_found" }, { headers: { "Cache-Control": "no-store" } });

  const outcome = await joinConsultation(deps, parsed.data.encounterId, parsed.data.media);
  return NextResponse.json(outcome, { headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDialIn } from "@/lib/consultations/room";
import { isPatientOnConsultation, mobileRoomDeps, readJson } from "@/lib/consultations/mobile-deps";

/**
 * Mobile consultation room (OQ-158): the last step of the ladder. Returns the vendor's published dial-in number(s), the meeting id
 * and the passcode for the SAME room, through the same function the web room calls (requestDialIn). Held in memory by the app for
 * the screen only; never stored or logged here. Nothing is rung from our side.
 */
const bodySchema = z.object({ encounterId: z.string().uuid() });

export async function POST(request: Request): Promise<NextResponse> {
  const deps = await mobileRoomDeps(request);
  if (deps instanceof NextResponse) return deps;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const patient = await isPatientOnConsultation(deps, parsed.data.encounterId);
  if (patient === "error") return NextResponse.json({ ok: false, reason: "not_allowed" }, { status: 500 });
  if (patient === "no") return NextResponse.json({ ok: false, reason: "not_allowed" }, { headers: { "Cache-Control": "no-store" } });

  const outcome = await requestDialIn(deps, parsed.data.encounterId);
  return NextResponse.json(outcome, { headers: { "Cache-Control": "no-store" } });
}

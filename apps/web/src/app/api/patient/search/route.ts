import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getActingFor } from "@/lib/acting/acting-for";
import { searchPatientRecord } from "@/lib/patient/record-search";

/**
 * The record half of the patient search box (gap P23). Patients only. The record searched is the signed-in person's own,
 * or, while they are acting for someone, that person's (re-checked against the live grant by getActingFor on every call).
 * See lib/patient/record-search.ts for what each group reads and how a grant limits it.
 */
const querySchema = z.string().trim().min(2).max(80);

export async function GET(request: Request): Promise<Response> {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Not signed in", { status: 401 });
  if (profile.role !== "patient") return new NextResponse("Not allowed", { status: 403 });

  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!parsed.success) return NextResponse.json({ results: [], failed: false });

  try {
    const acting = await getActingFor();
    const supabase = await createClient();
    const body = await searchPatientRecord(supabase, { userId: profile.id, subjectId: acting?.profileId ?? profile.id }, parsed.data);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ results: [], failed: true }, { headers: { "Cache-Control": "no-store" } });
  }
}

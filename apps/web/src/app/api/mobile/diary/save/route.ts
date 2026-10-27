import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { handleDiarySave } from "@/lib/diary/handlers";

/**
 * The phone's door for saving CONFIRMED paper diary rows (S07y). Same handler as the web action; bearer-token auth. Online only: a diary row is dated inside a
 * bounded window and the server keeps it only if it is inside that window when it arrives, so it is never queued for a blind retry.
 *
 * Optionally scoped to a person the caller supports (beneficiary_profile_id), re-checked here against can_act_for on every request, as the quick-log route does.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const beneficiary = z.object({ beneficiary_profile_id: z.string().uuid().optional() }).safeParse(body);
  let subjectId = user.id;
  if (beneficiary.success && beneficiary.data.beneficiary_profile_id) {
    const { data: allowed } = await supabase.rpc("can_act_for", { p_beneficiary: beneficiary.data.beneficiary_profile_id });
    if (allowed !== true) return NextResponse.json({ error: "You don't have permission to log this for that person." }, { status: 403 });
    subjectId = beneficiary.data.beneficiary_profile_id;
  }

  const { httpStatus, body: result } = await handleDiarySave(supabase, { userId: user.id, subjectId, route: "api/mobile/diary/save" }, body);
  return NextResponse.json(result, { status: httpStatus, headers: { "Cache-Control": "private, no-store" } });
}

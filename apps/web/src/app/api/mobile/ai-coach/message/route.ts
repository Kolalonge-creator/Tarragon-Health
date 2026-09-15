import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { coachMessageSchema } from "@/lib/validation/ai-coach";
import { runCoachTurn } from "@/lib/ai-coach";

/**
 * Mobile equivalent of apps/web/.../patient/ai-coach-actions.ts's
 * sendCoachMessage. runCoachTurn (lib/ai-coach/index.ts) is already
 * transport-agnostic by design -- entitlement/rate-limit gating, the
 * governed Claude call, the emergency-keyword safety net, and the audit
 * write are exactly the same logic the web server action runs, just reached
 * over a bearer-authenticated route instead of a cookie-authenticated one.
 */
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

  const parsed = coachMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  try {
    const result = await runCoachTurn({
      supabase,
      getServiceRoleSupabase: createServiceRoleClient,
      profileId: user.id,
      organisationId: profile.organisation_id,
      conversationId: parsed.data.conversationId,
      message: parsed.data.message,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Something went wrong" },
      { status: 500 }
    );
  }
}

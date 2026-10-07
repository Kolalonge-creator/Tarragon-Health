import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendApprovedPrepDraft } from "@/lib/ai-coach/send-prep-draft";

/**
 * Mobile equivalent of handoff-actions.ts's sendApprovedPrepDraftAction (S51, 7.7). The patient has read, edited and chosen to send
 * the pre-visit message; this opens the care thread on THEIR session. Deliberately not behind the assistant_enabled guard: it is a
 * patient writing to their own care team, which never waits on an AI guard.
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

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return NextResponse.json({ error: "No organisation on file" }, { status: 400 });

  const result = await sendApprovedPrepDraft({
    supabase,
    getServiceRoleSupabase: createServiceRoleClient,
    profileId: user.id,
    organisationId: profile.organisation_id,
    input: body,
  });
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, threadId: result.threadId });
}

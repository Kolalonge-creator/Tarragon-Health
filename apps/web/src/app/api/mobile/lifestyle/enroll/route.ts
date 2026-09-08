import { NextResponse } from "next/server";
import { z } from "zod";
import { CONDITION_KEYS } from "@tarragon/lifestyle-engine";
import { createBearerClient } from "@/lib/supabase/bearer";
import { enrollPatient } from "@/lib/lifestyle/service";

/**
 * Mobile equivalent of apps/web/.../patient/lifestyle/actions.ts's
 * enrollAction. `enrollPatient` writes with a service-role client
 * internally (programme/phase/goal materialisation is system-authored, not
 * something even a web session's own RLS-scoped client may do) — that's the
 * one reason this needs a route at all rather than a direct client insert,
 * same rationale as every other /api/mobile/* route that wraps a
 * server-only helper. Auth/ownership is still fully re-checked here from the
 * bearer token, same as the web action re-derives ctx.userId/orgId from the
 * session rather than trusting a client-supplied id.
 */
const bodySchema = z.object({
  conditionKey: z.enum(CONDITION_KEYS),
  consent: z.boolean(),
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
    return NextResponse.json({ error: "Unknown programme" }, { status: 400 });
  }
  if (!parsed.data.consent) {
    return NextResponse.json({ error: "Please agree to the consent statement to start." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const result = await enrollPatient(user.id, profile.organisation_id, parsed.data.conditionKey);
  if (!result.ok) {
    if (result.reason === "ed_screen_required") {
      return NextResponse.json({ needsEdScreen: true });
    }
    return NextResponse.json({ error: `Could not enrol (${result.reason ?? "error"})` }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: "You're enrolled. Small steps from here." });
}

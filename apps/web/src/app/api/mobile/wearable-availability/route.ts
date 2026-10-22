import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { unavailableWearableProviders } from "@/lib/wearables/oauth-providers";

/**
 * Which cloud wearable providers are switched off for NEW connections (S70b). The same list the web Connect card and connect route use
 * (`unavailableWearableProviders`, env WEARABLE_UNAVAILABLE_PROVIDERS), so the phone never keeps its own copy. Bearer-authed like the other mobile
 * routes; the list is not patient data. The phone treats a failure as "unknown" and assumes nothing rather than guessing.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  return NextResponse.json({ unavailable: unavailableWearableProviders() });
}

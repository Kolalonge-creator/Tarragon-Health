import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { getMobileThresholds } from "@/lib/vitals/mobile-thresholds";

/**
 * Serves the current BP/glucose red-flag threshold constants + a version
 * string so the mobile app's bundled offline classifier
 * (apps/mobile/src/lib/{glucose-red-flags,bp-classification}.ts) can detect
 * drift from this source of truth and refresh its cached copy when online —
 * see docs/MOBILE_APP_SPEC.md §6. No DB access; the values come straight
 * from the same constants the server-side classifiers use, never duplicated.
 *
 * Bearer-authed like the other /api/mobile/* routes, purely to keep this off
 * the public internet — the numbers themselves aren't patient data.
 */
export async function GET(request: Request): Promise<NextResponse> {
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

  return NextResponse.json(getMobileThresholds());
}

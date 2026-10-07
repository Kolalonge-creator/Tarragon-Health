import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { mentalHealthScreenSchema } from "@/lib/validation/mental-health-screen";
import { saveMentalHealthScreens } from "@/lib/mental-health/save-screens";

/**
 * Mobile equivalent of apps/web/.../patient/mental-health-actions.ts's submitMentalHealthScreen. Both call
 * lib/mental-health/save-screens.ts (S56), so scoring, the service-role insert, the crisis route and the hazardous-alcohol referral
 * are one body of code reached over a bearer-authenticated route instead of a cookie-authenticated server action.
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

  const parsed = mentalHealthScreenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please answer every question" },
      { status: 400 }
    );
  }

  const result = await saveMentalHealthScreens({ userClient: supabase, userId: user.id, answers: parsed.data });
  if (!result.ok) {
    const status = result.error === "No organisation on file" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ success: true, crisis: result.crisis });
}

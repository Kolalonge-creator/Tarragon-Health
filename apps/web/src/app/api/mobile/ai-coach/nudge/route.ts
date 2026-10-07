import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { loadAssistantNudges } from "@/lib/ai-coach/nudge-load";

/** Mobile counterpart of nudge-actions.ts (S51, 7.5). Closed (403) while the assistant_enabled guard is closed. */
export async function GET(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  try {
    const nudges = await loadAssistantNudges(supabase, user.id);
    if (!nudges.open) return NextResponse.json({ success: false, code: "assistant_not_open" }, { status: 403 });
    return NextResponse.json({ success: true, ...nudges });
  } catch {
    return NextResponse.json({ error: "Could not load your check-in" }, { status: 500 });
  }
}

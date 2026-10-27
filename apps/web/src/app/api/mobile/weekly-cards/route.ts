import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { loadWeeklyCards } from "@/lib/today/weekly-cards";

/**
 * The weekly summary cards for the phone (S47b). The same answer as the web, from the same loader: `{ state: "hidden" }` means show nothing at all
 * (the configuration is not signed, or no source could be read) and carries no reason. The cards describe what the person logged and never grade it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  const result = await loadWeeklyCards(supabase, user.id);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

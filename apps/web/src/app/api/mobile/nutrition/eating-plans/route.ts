import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { loadEatingGuidance } from "@/lib/nutrition/eating-plans";

/**
 * Swaps and eating plans for the phone (S50a). The body is the database gate's own answer, untouched, so the phone parses exactly what the
 * database said. `{ state: "unavailable" }` means show nothing at all and carries no reason (not signed yet and not for you are the same).
 * A database FAILURE is a 503, never an "unavailable": the phone then keeps its saved copy instead of erasing it on an answer nobody gave.
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

  const view = await loadEatingGuidance(supabase);
  if (view.failed) return NextResponse.json({ error: "Could not load" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json(view.raw, { headers: { "Cache-Control": "private, no-store" } });
}

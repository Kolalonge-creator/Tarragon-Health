import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { loadNutritionGuidance } from "@/lib/nutrition/guidance";

/**
 * Today's targets and totals for the phone. The answer is the same as the web's and comes from the same database gate:
 * `{ state: "hidden" }` means show nothing at all (targets are withheld for this person, or not yet signed off), and carries no reason.
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

  const guidance = await loadNutritionGuidance(supabase, user.id);
  return NextResponse.json(guidance, { headers: { "Cache-Control": "private, no-store" } });
}

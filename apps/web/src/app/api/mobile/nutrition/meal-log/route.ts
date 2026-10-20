import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { insertMeal } from "@/lib/nutrition/meal-log";
import { MEAL_TYPES } from "@/lib/validation/nutrition";

/**
 * A text meal from the phone, usually replayed from the offline outbox (S06). The phone sends only WORDS and an id it minted: the
 * nutrition numbers are recomputed here from the food table, never trusted from the device, so an old build or a tampered client
 * cannot write its own calories. `client_id` makes the send idempotent: a retry after a lost reply is answered `duplicate: true`
 * with a 200, which the outbox treats as done.
 */
const bodySchema = z.object({
  meal_type: z.enum(MEAL_TYPES),
  description: z.string().trim().min(1).max(500),
  client_id: z.string().uuid(),
  client_recorded_at: z.string().datetime({ offset: true }).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return NextResponse.json({ error: "No organisation on file" }, { status: 400 });

  const result = await insertMeal(
    supabase,
    { userId: user.id, organisationId: profile.organisation_id },
    {
      mealType: parsed.data.meal_type,
      description: parsed.data.description,
      clientId: parsed.data.client_id,
      clientRecordedAt: parsed.data.client_recorded_at ?? null,
    },
  );
  if (!result.ok) {
    // The outbox retries a 5xx and holds a 4xx for the person, so the status must say which this is: an unreadable food list is retryable (503);
    // a rule the database refused (data 22xxx, constraint 23xxx, permission 42501) will never succeed on retry.
    if (result.retryable) return NextResponse.json({ error: result.error }, { status: 503 });
    if (result.code === "42501") return NextResponse.json({ error: "That meal could not be saved." }, { status: 403 });
    if (result.code && /^(22|23)/.test(result.code)) return NextResponse.json({ error: "That meal could not be saved." }, { status: 422 });
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true, duplicate: result.duplicate, entryId: result.id });
}

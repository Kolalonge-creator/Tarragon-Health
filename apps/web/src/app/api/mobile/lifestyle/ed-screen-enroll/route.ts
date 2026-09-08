import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { enrollPatient } from "@/lib/lifestyle/service";
import { obesityEdScreenSchema } from "@/lib/validation/obesity";

/**
 * Mobile equivalent of apps/web/.../patient/lifestyle/actions.ts's
 * submitObesityEdScreenAndEnrollAction. The screen answers are a plain
 * RLS-scoped insert (a patient may insert their own obesity_ed_screens row)
 * — scoring, alert-raising, and any weight-loss auto-pause on an existing
 * enrolment are DB-trigger owned (private.handle_obesity_ed_screen), not
 * app code, so there is nothing safety-critical duplicated here. Only the
 * second half (enrollPatient) needs a route at all, for the same
 * service-role reason as /api/mobile/lifestyle/enroll.
 */
const bodySchema = obesityEdScreenSchema.extend({
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
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  if (!parsed.data.consent) {
    return NextResponse.json({ error: "Please agree to the consent statement to start." }, { status: 400 });
  }
  const input = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const { data: saved, error: screenErr } = await supabase
    .from("obesity_ed_screens")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      scoff_sick: input.scoff_sick ?? false,
      scoff_control: input.scoff_control ?? false,
      scoff_one_stone: input.scoff_one_stone ?? false,
      scoff_fat: input.scoff_fat ?? false,
      scoff_food_dominates: input.scoff_food_dominates ?? false,
      self_harm_risk: input.self_harm_risk ?? false,
      low_mood: input.low_mood ?? false,
      disordered_behaviours: input.disordered_behaviours,
      notes: input.notes ?? null,
    })
    .select("positive")
    .single();
  if (screenErr || !saved) {
    return NextResponse.json({ error: "Could not save your answers, please try again." }, { status: 500 });
  }

  const result = await enrollPatient(user.id, profile.organisation_id, "obesity");
  if (!result.ok) {
    return NextResponse.json({ error: `Could not enrol (${result.reason ?? "error"})` }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    message: saved.positive
      ? "Thanks for sharing that. Your care team will reach out to talk it through before we start on weight-loss goals; you're still enrolled and supported in the meantime."
      : "You're enrolled. Small steps from here.",
  });
}

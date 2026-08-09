import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessHealthScoreBestEffort } from "@/lib/health-score/assess-health-score";
import { bloodPressureSchema } from "@/lib/validation/vitals";
import type { TablesInsert } from "@tarragon/shared";

/**
 * Manual-entry vitals ingestion for the Expo mobile app's native "Log a
 * blood pressure reading" quick-log (the highest-frequency native write in
 * the app per docs/MOBILE_APP_SPEC.md §2.2) — mirrors logVital's
 * blood_pressure branch in apps/web/src/app/(dashboard)/patient/actions.ts
 * (insert + BP-control ML assessment + health-score reassessment) so a
 * dangerous reading logged from the phone escalates exactly like one logged
 * on web, per CLAUDE.md's "never deprioritise or silently swallow an
 * abnormal result" rule. Only blood_pressure is handled — that's the only
 * vital type the current native screen collects; other manual vital types
 * still go through the web quick-log until a native screen needs them.
 *
 * Scoped to the signed-in user only, no "acting for a dependant" support —
 * same simplification as the other /api/mobile/* routes (device-readings,
 * cgm-readings, health-samples), none of which resolve acting-for either.
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

  const parsed = bloodPressureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { systolic, diastolic, note, taken_at } = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const row: TablesInsert<"vitals_readings"> = {
    patient_id: user.id,
    organisation_id: profile.organisation_id,
    source: "manual",
    vital_type: "blood_pressure",
    systolic,
    diastolic,
    note: note ?? null,
    taken_at: taken_at ? new Date(taken_at).toISOString() : new Date().toISOString(),
  };

  const { error: insertError } = await supabase.from("vitals_readings").insert(row);
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await assessBpControlBestEffort(supabase, user.id, profile.organisation_id);
  await assessHealthScoreBestEffort(supabase, user.id, profile.organisation_id);

  return NextResponse.json({ success: true });
}

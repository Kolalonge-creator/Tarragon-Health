import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessGlucoseBestEffort } from "@/lib/vitals/assess-glucose";
import { runBestEffort } from "@/lib/sentry/run-best-effort";
import { photoReadingSchema } from "@/lib/validation/photo-reading";
import { readDeviceFlags } from "@/lib/devices/flags";
import { readOutcome } from "@/lib/devices/reading-outcome";
import type { TablesInsert } from "@tarragon/shared";

/**
 * Photo reading capture (S70a, 18.3): a reading the person photographed from a device screen and checked digit by digit.
 *
 * The photo never reaches this route (text recognition ran on the phone, no cloud vision model is involved, OQ-312). What arrives is the
 * confirmed numbers. They are stored with source "photo_confirmed" in the one vitals_readings table and go through exactly the same
 * deterministic triage as a typed reading: the red-flag triggers fire on insert whatever the source, and the same best-effort assessments run
 * afterwards. An impossible value is held for the person to check by the database, never saved or triaged.
 *
 * DORMANT behind the `device_photo_capture` module: 404 until an admin switches it on.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  const flags = await readDeviceFlags(supabase);
  if (!flags.device_photo_capture) return NextResponse.json({ error: "Photo capture is not switched on yet" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = photoReadingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { client_reading_id, reading, patient_id } = parsed.data;

  // The time of the photo: never in the future, and never so old it could be used to back-fill a record.
  const now = Date.now();
  const taken = Date.parse(parsed.data.taken_at);
  if (now - taken > 7 * 24 * 3600_000) {
    return NextResponse.json({ error: "This photo is more than 7 days old. Please take the reading again." }, { status: 422 });
  }
  const takenAt = new Date(Math.min(taken, now)).toISOString();

  // Whose reading: the person's own, or someone they manage (a shared phone). The same check the database uses for a supporter's insert.
  const subject = patient_id ?? user.id;
  let loggedBy: string | null = null;
  if (subject !== user.id) {
    const { data: allowed } = await supabase.rpc("can_act_for", { p_beneficiary: subject });
    if (allowed !== true) return NextResponse.json({ error: "Not found" }, { status: 404 });
    loggedBy = user.id;
  }
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", subject).single();
  if (!profile?.organisation_id) return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  const organisationId = profile.organisation_id;

  const shared = {
    patient_id: subject,
    organisation_id: organisationId,
    ...(loggedBy ? { logged_by_profile_id: loggedBy } : {}),
    source: "photo_confirmed" as const,
    client_reading_id,
    taken_at: takenAt,
  };
  const row: TablesInsert<"vitals_readings"> =
    reading.vital_type === "blood_pressure"
      ? { ...shared, vital_type: "blood_pressure", systolic: reading.systolic, diastolic: reading.diastolic, pulse_bpm: reading.pulse_bpm, cuff_type: reading.cuff_type }
      : reading.vital_type === "glucose"
        ? { ...shared, vital_type: "glucose", glucose_mmol_l: reading.glucose_mmol_l, glucose_context: reading.glucose_context }
        : reading.vital_type === "weight"
          ? { ...shared, vital_type: "weight", weight_kg: reading.weight_kg }
          : reading.vital_type === "temperature"
            ? { ...shared, vital_type: "temperature", temperature_c: reading.temperature_c }
            : { ...shared, vital_type: "spo2", spo2_pct: reading.spo2_pct, pulse_bpm: reading.pulse_bpm };

  const { error: insertError } = await supabase.from("vitals_readings").insert(row);
  if (insertError) {
    // 23505 on vitals_readings_client_dedupe_idx: this exact reading was already saved (an offline-queue retry), an idempotent success.
    if (insertError.code === "23505") return NextResponse.json({ success: true, deduped: true });
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // The insert can succeed and store nothing in the record: an impossible value is held for the person, a duplicate of a better source is linked.
  const outcome = await readOutcome(supabase, { patientId: subject, clientReadingId: client_reading_id });
  if (outcome.kind === "held") return NextResponse.json({ success: true, held: true, held_id: outcome.heldId, reasons: outcome.reasons });
  if (outcome.kind === "merged") return NextResponse.json({ success: true, merged: true });

  // The same post-insert assessments as a device or typed reading. Never throw out of the route for a reading already saved; a failure is
  // reported to Sentry and surfaced in the body, never swallowed (CLAUDE.md: never silently swallow an abnormal result).
  let safetyAssessmentFailed = false;
  const extra = { route: "api/mobile/photo-readings", stage: "safety_assessment", vitalType: reading.vital_type, patientId: subject, organisationId };
  if (reading.vital_type === "blood_pressure") {
    safetyAssessmentFailed = await runBestEffort(() => assessBpControlBestEffort(supabase, subject, organisationId), extra);
  } else if (reading.vital_type === "glucose") {
    safetyAssessmentFailed = await runBestEffort(() => assessGlucoseBestEffort(supabase, subject, organisationId), extra);
  }
  return NextResponse.json({ success: true, ...(safetyAssessmentFailed ? { safetyAssessmentFailed: true } : {}) });
}

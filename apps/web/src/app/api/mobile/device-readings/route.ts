import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { deviceReadingSchema } from "@/lib/validation/device-reading";
import { mgDlToMmolL, type TablesInsert } from "@tarragon/shared";

/**
 * Device-sync ingestion boundary for the Expo mobile app — CLAUDE.md
 * "Device & Wearable Integration": the ML service/web platform never talks
 * to device firmware directly, the mobile app's native BLE does the
 * pairing/parsing and posts the already-decoded reading here. This is the
 * single choke point for device-sourced readings so the same downstream
 * pipeline (BP-control ML assessment, patient_risk_scores) always fires
 * regardless of which screen/path produced the reading — mirrors
 * logVital's manual-entry insert in apps/web/src/app/(dashboard)/patient/actions.ts,
 * just authenticated via bearer token instead of a Next.js cookie session.
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

  const parsed = deviceReadingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const reading = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  // RLS already scopes this to the caller's own devices; the explicit
  // patient_id/status filter also turns "someone else's device" and "an
  // unpaired device" into a clean 404 instead of a silent RLS-empty result.
  const { data: device } = await supabase
    .from("patient_devices")
    .select("id")
    .eq("id", reading.device_id)
    .eq("patient_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!device) {
    return NextResponse.json({ error: "Device not found or not paired" }, { status: 404 });
  }

  const { vital_type, device_id, external_reading_id, taken_at } = reading;
  const shared = {
    patient_id: user.id,
    organisation_id: profile.organisation_id,
    source: "device" as const,
    device_id,
    external_reading_id,
    taken_at,
  };

  const row: TablesInsert<"vitals_readings"> =
    vital_type === "blood_pressure"
      ? { ...shared, vital_type, systolic: reading.systolic, diastolic: reading.diastolic, pulse_bpm: reading.pulse_bpm }
      : vital_type === "glucose"
        ? {
            ...shared,
            vital_type,
            glucose_context: reading.glucose_context,
            glucose_mmol_l:
              reading.glucose_unit === "mg_dl" ? mgDlToMmolL(reading.glucose_value) : reading.glucose_value,
          }
        : vital_type === "weight"
          ? { ...shared, vital_type, weight_kg: reading.weight_kg }
          : vital_type === "temperature"
            ? { ...shared, vital_type, temperature_c: reading.temperature_c }
            : { ...shared, vital_type, spo2_pct: reading.spo2_pct, pulse_bpm: reading.pulse_bpm };

  const { error: insertError } = await supabase.from("vitals_readings").insert(row);
  if (insertError) {
    // 23505 = unique_violation on vitals_readings_device_dedupe_idx — this
    // exact reading was already synced (retry/resync), so it's an
    // idempotent success, not an error; the pipeline already ran the first
    // time this row was inserted.
    if (insertError.code === "23505") {
      return NextResponse.json({ success: true, deduped: true });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await supabase
    .from("patient_devices")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", device_id);

  if (vital_type === "blood_pressure") {
    await assessBpControlBestEffort(supabase, user.id, profile.organisation_id);
  }

  return NextResponse.json({ success: true });
}

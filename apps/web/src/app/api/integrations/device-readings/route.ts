import { NextResponse } from "next/server";
import { hasScope, verifyApiKey } from "@/lib/integrations/api-key";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessGlucoseBestEffort } from "@/lib/vitals/assess-glucose";
import { runBestEffort } from "@/lib/sentry/run-best-effort";
import { integrationReadingSchema } from "@/lib/validation/integration-reading";
import { mgDlToMmolL, type TablesInsert } from "@tarragon/shared";

/**
 * Server-to-server device-reading ingestion for integration partners
 * (device clouds, vendor platforms) authenticated by an org API key —
 * the third ingestion path alongside manual entry and the mobile app's
 * BLE sync, all landing in the same vitals_readings table so the same
 * downstream pipeline (BP-control assessment, risk scores, escalations)
 * fires regardless of origin. No parallel table, per CLAUDE.md's
 * "Device & Wearable Integration" rules.
 *
 * The partner identifies the patient by patient_number and the device by
 * vendor serial; a patient_devices row is provisioned per (patient,
 * serial) so the existing (device_id, external_reading_id) dedupe index
 * makes retries idempotent and the device shows up in the patient's own
 * device list with a real last_synced_at.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const verified = await verifyApiKey(request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  }
  if (!hasScope(verified, "device_readings:write")) {
    return NextResponse.json({ error: "API key lacks the device_readings:write scope" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = integrationReadingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const reading = parsed.data;

  const supabase = createServiceRoleClient();

  // The key is org-scoped: a patient_number outside the key's organisation
  // resolves to a clean 404, never a cross-tenant read.
  const { data: patient } = await supabase
    .from("profiles")
    .select("id")
    .eq("patient_number", reading.patient_number)
    .eq("organisation_id", verified.organisationId)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this organisation" }, { status: 404 });
  }

  // Find-or-create the device row for this vendor serial. The api: prefix
  // keeps cloud-integrated devices distinguishable from BLE-paired ones.
  const bleDeviceId = `api:${reading.device.serial}`;
  const { data: existingDevice } = await supabase
    .from("patient_devices")
    .select("id, status")
    .eq("patient_id", patient.id)
    .eq("ble_device_id", bleDeviceId)
    .maybeSingle();

  let deviceId = existingDevice?.id ?? null;
  if (existingDevice && existingDevice.status !== "active") {
    return NextResponse.json({ error: "Device is unpaired/inactive for this patient" }, { status: 409 });
  }
  if (!deviceId) {
    const { data: created, error: deviceError } = await supabase
      .from("patient_devices")
      .insert({
        patient_id: patient.id,
        organisation_id: verified.organisationId,
        device_type: reading.device.type,
        ble_device_id: bleDeviceId,
        model: reading.device.model ?? null,
      })
      .select("id")
      .single();
    if (deviceError || !created) {
      return NextResponse.json({ error: "Could not register the device" }, { status: 500 });
    }
    deviceId = created.id;
  }

  const shared = {
    patient_id: patient.id,
    organisation_id: verified.organisationId,
    source: "device" as const,
    device_id: deviceId,
    external_reading_id: reading.external_reading_id,
    taken_at: reading.taken_at,
  };

  const { vital_type } = reading;
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
    // 23505 = the dedupe index — this exact reading was already ingested
    // (partner retry), so it's an idempotent success.
    if (insertError.code === "23505") {
      return NextResponse.json({ success: true, deduped: true });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await supabase
    .from("patient_devices")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", deviceId);

  // From here on the reading is durably saved (and patient_devices already
  // updated above). assessBpControlBestEffort/assessGlucoseBestEffort are
  // documented "never throws," but that isn't literally enforced by a
  // try/catch inside either of them (confirmed by reading both), so a
  // genuine network/DB drop right after the insert can still throw here.
  // Without runBestEffort, that throw would propagate out of this route
  // handler as an uncaught exception — Next.js turns that into a 500, which
  // would tell an integration partner this write failed when the reading is
  // in fact already stored, inviting a blind partner-side retry that also
  // wouldn't re-run this assessment anyway (a replayed external_reading_id
  // hits the 23505 dedupe branch above and returns early without reaching
  // here). These two calls are the platform's actual red-flag/escalation
  // detection for this reading (BP crisis, DKA/severe hypo) — CLAUDE.md is
  // explicit that an abnormal-result event must "never deprioritise or
  // silently swallow" it, so a failure is reported to Sentry AND surfaced in
  // the response body rather than a silent, unqualified success.
  let safetyAssessmentFailed = false;
  // patientId/organisationId included so an on-call engineer triaging a
  // spike of these Sentry events can tell whether it's one patient retried
  // many times or many patients/orgs affected, without cross-referencing
  // application logs first.
  const safetyExtra = {
    route: "api/integrations/device-readings",
    stage: "safety_assessment",
    vitalType: vital_type,
    patientId: patient.id,
    organisationId: verified.organisationId,
  };
  if (vital_type === "blood_pressure") {
    safetyAssessmentFailed = await runBestEffort(
      () => assessBpControlBestEffort(supabase, patient.id, verified.organisationId),
      safetyExtra
    );
  } else if (vital_type === "glucose") {
    safetyAssessmentFailed = await runBestEffort(
      () => assessGlucoseBestEffort(supabase, patient.id, verified.organisationId),
      safetyExtra
    );
  }

  return NextResponse.json({
    success: true,
    ...(safetyAssessmentFailed ? { safetyAssessmentFailed: true } : {}),
  });
}

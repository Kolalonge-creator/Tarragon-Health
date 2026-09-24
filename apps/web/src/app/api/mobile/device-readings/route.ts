import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessGlucoseBestEffort } from "@/lib/vitals/assess-glucose";
import { runBestEffort } from "@/lib/sentry/run-best-effort";
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
  // Narrowed into its own const: TS can't carry the null-check above through
  // the runBestEffort closures further down, which read this via a fresh
  // arrow function rather than a direct access.
  const organisationId = profile.organisation_id;

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
    // time this row was inserted. Still counted (55.10 "duplicate data").
    if (insertError.code === "23505") {
      await supabase.rpc("bump_patient_device_ingestion_counters", {
        p_device_id: device_id,
        p_duplicates: 1,
      });
      return NextResponse.json({ success: true, deduped: true });
    }
    // 55.12 patient tech-support auto-diagnosis reads this column — a real
    // insert failure must be visible there, not just in this response.
    await supabase.rpc("bump_patient_device_ingestion_counters", {
      p_device_id: device_id,
      p_last_error: insertError.message,
    });
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // A real reading arriving is the signal that clears a prior "no data"
  // flag from the device-connectivity cron (see
  // /api/cron/device-connectivity-check) — the device is transmitting
  // again, so there is no longer anything to notify the patient about.
  await supabase
    .from("patient_devices")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
      connectivity_status: "ok",
      connectivity_notified_at: null,
    })
    .eq("id", device_id);

  // From here on the reading is durably saved (and patient_devices already
  // updated above). assessBpControlBestEffort/assessGlucoseBestEffort are
  // documented "never throws," but that isn't literally enforced by a
  // try/catch inside either of them (confirmed by reading both), so a
  // genuine network/DB drop right after the insert can still throw here.
  // Without runBestEffort, that throw would propagate out of this route
  // handler as an uncaught exception — Next.js turns that into a 500, and
  // the BLE offline queue (offline-queue.ts's flushDeviceReadingsQueue)
  // STOPS at the first non-success response, stalling every OTHER queued
  // reading behind this one until the next flush. A retry also wouldn't
  // re-run this assessment anyway: a replayed external_reading_id hits the
  // 23505 dedupe branch above and returns early without reaching here. These
  // two calls are the platform's actual red-flag/escalation detection for
  // this reading (BP crisis, DKA/severe hypo) — CLAUDE.md is explicit that
  // an abnormal-result event must "never deprioritise or silently swallow"
  // it, so a failure is reported to Sentry AND surfaced in the response body
  // rather than a silent, unqualified success.
  let safetyAssessmentFailed = false;
  // patientId/organisationId included so an on-call engineer triaging a
  // spike of these Sentry events can tell whether it's one patient retried
  // many times or many patients/orgs affected, without cross-referencing
  // application logs first.
  const safetyExtra = {
    route: "api/mobile/device-readings",
    stage: "safety_assessment",
    vitalType: vital_type,
    patientId: user.id,
    organisationId,
  };
  if (vital_type === "blood_pressure") {
    safetyAssessmentFailed = await runBestEffort(
      () => assessBpControlBestEffort(supabase, user.id, organisationId),
      safetyExtra
    );
  } else if (vital_type === "glucose") {
    safetyAssessmentFailed = await runBestEffort(
      () => assessGlucoseBestEffort(supabase, user.id, organisationId),
      safetyExtra
    );
  }

  return NextResponse.json({
    success: true,
    ...(safetyAssessmentFailed ? { safetyAssessmentFailed: true } : {}),
  });
}

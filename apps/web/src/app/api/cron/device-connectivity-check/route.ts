import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * "No data arrived from a connected device" sweep — spec §52.10:
 *
 *   Expected data -> No data -> Determine whether device issue -> Notify
 *   patient -> Technical support
 *
 * This route only ever does the first half (detect + notify); it
 * deliberately never touches vitals_readings, patient_risk_scores, or any
 * other clinical table — spec §52.10 is explicit that missing data must
 * never be auto-interpreted as clinical improvement, so the only side
 * effect here is a device-layer flag plus a non-clinical in-app nudge. The
 * "technical support" step is the patient (or staff, on a patient's behalf)
 * filing a device_fault_reports row once they notice — see
 * apps/web/src/app/(dashboard)/patient/actions.ts's reportDeviceFault — and
 * connectivity_status = 'no_data' is itself already visible to org staff
 * on patient_devices via RLS, so a "device gone quiet" patient is
 * discoverable without a separate ops surface.
 *
 * Threshold is a flat 7 days, not tied to any per-patient care-plan reading
 * cadence (no such cadence field exists on care_plans/medication_reviews
 * today) — deliberately conservative so an infrequently-used BP cuff/
 * glucometer does not generate a false "device broken" nudge; a genuinely
 * silent device only needs to be caught eventually, not within hours.
 * Re-notification is throttled separately so one persistently-quiet device
 * does not re-notify the patient on every run of this cron.
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron
 * routes (see e.g. api/cron/wearable-sync).
 */
const STALE_AFTER_MS = 7 * 24 * 3600_000;
const RENOTIFY_AFTER_MS = 3 * 24 * 3600_000;

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = Date.now();
  const staleCutoff = new Date(now - STALE_AFTER_MS).toISOString();
  const renotifyCutoff = new Date(now - RENOTIFY_AFTER_MS).toISOString();

  const { data: devices, error } = await supabase
    .from("patient_devices")
    .select("id, organisation_id, patient_id, device_type, nickname, manufacturer, model, paired_at, last_synced_at, connectivity_notified_at")
    .eq("status", "active");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const totals = { devicesConsidered: devices?.length ?? 0, flaggedNoData: 0, notified: 0 };

  for (const device of devices ?? []) {
    const referenceAt = device.last_synced_at ?? device.paired_at;
    const isStale = referenceAt !== null && new Date(referenceAt).getTime() < new Date(staleCutoff).getTime();
    if (!isStale) continue;

    totals.flaggedNoData += 1;

    const alreadyNotifiedRecently =
      device.connectivity_notified_at !== null &&
      new Date(device.connectivity_notified_at).getTime() >= new Date(renotifyCutoff).getTime();
    if (alreadyNotifiedRecently) {
      // Keep the flag current without re-notifying or resetting the
      // throttle clock.
      await supabase.from("patient_devices").update({ connectivity_status: "no_data" }).eq("id", device.id);
      continue;
    }

    const nowIso = new Date(now).toISOString();
    await supabase
      .from("patient_devices")
      .update({ connectivity_status: "no_data", connectivity_notified_at: nowIso })
      .eq("id", device.id);

    const deviceLabel =
      device.nickname ?? ([device.manufacturer, device.model].filter(Boolean).join(" ") || device.device_type);
    await supabase.from("notifications").insert({
      organisation_id: device.organisation_id,
      recipient_id: device.patient_id,
      channel: "in_app",
      status: "pending",
      template: "device_no_data_received",
      payload: {
        patient_device_id: device.id,
        device_type: device.device_type,
        device_label: deviceLabel,
        message: `We haven't received any readings from your ${deviceLabel} in a while. Please check that it's charged, paired, and in range — or let us know if it needs replacing.`,
      },
    });
    totals.notified += 1;
  }

  return Response.json(totals);
}

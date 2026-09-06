import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@tarragon/shared";

type IntegrationComponent = Database["public"]["Enums"]["integration_component"];
type IntegrationHealthState = Database["public"]["Enums"]["integration_health_state"];
type PatientDeviceType = Database["public"]["Enums"]["patient_device_type"];
type WearableProvider = Database["public"]["Enums"]["wearable_provider"];

const BLE_COMPONENTS: Partial<Record<IntegrationComponent, PatientDeviceType>> = {
  ble_bp_cuff: "bp_cuff",
  ble_glucometer: "glucometer",
  ble_scale: "scale",
  ble_thermometer: "thermometer",
  ble_pulse_oximeter: "pulse_oximeter",
};

const WEARABLE_COMPONENTS: Partial<Record<IntegrationComponent, WearableProvider>> = {
  wearable_oura: "oura",
  wearable_whoop: "whoop",
  wearable_garmin: "garmin",
  wearable_fitbit: "fitbit",
  wearable_dexcom: "dexcom",
  apple_health_bridge: "apple_health",
  android_health_connect_bridge: "android_health_connect",
};

const BLE_STALE_DAYS = 14;
const WEARABLE_STALE_DAYS = 3;
/** Below this many active rows there isn't enough signal to call a component
 * down or degraded from error/staleness rate alone — a lone patient who
 * hasn't opened the app in a week is not a platform incident. */
const MIN_SAMPLE = 3;

interface ComponentSample {
  total: number;
  errors: number;
  stale: number;
}

function classify(sample: ComponentSample): { state: IntegrationHealthState; note: string | null } {
  if (sample.total < MIN_SAMPLE) return { state: "operational", note: null };
  const errorRate = sample.errors / sample.total;
  const staleRate = sample.stale / sample.total;
  if (errorRate >= 0.5) {
    return { state: "down", note: `${sample.errors}/${sample.total} active connections in error` };
  }
  if (errorRate >= 0.2 || staleRate >= 0.5) {
    return {
      state: "degraded",
      note: `${sample.errors}/${sample.total} in error, ${sample.stale}/${sample.total} stale`,
    };
  }
  if (staleRate >= 0.2) {
    return { state: "delayed", note: `${sample.stale}/${sample.total} active connections stale` };
  }
  return { state: "operational", note: null };
}

/**
 * 55.11 integration health + 55.16/55.17 clinical downtime workflow.
 *
 * There is no APM/webhook-failure telemetry to read (confirmed by the
 * research behind this feature: zero console.error/Sentry calls anywhere in
 * lib/wearables/ or the wearable API routes today), so health is inferred
 * from the same columns the rest of the connection-fleet dashboard already
 * reads: a connection's own status/last_sync_error (wearable_connections) or
 * last_sync_error (patient_devices), and staleness of last_synced_at. This
 * is a real, if coarse, signal — not a placeholder — and is the only signal
 * available without adding request-level instrumentation to every ingestion
 * route (a larger, separate change).
 *
 * State transitions are what matter, not the classification alone: a
 * component moving to 'down' opens an integration_incidents row (which
 * itself raises the 55.17 clinician_alerts fan-out via a DB trigger — see
 * 20260829023051_integration_health_status_and_incidents.sql); a component
 * recovering from 'down' resolves the open incident. Non-'down' transitions
 * (e.g. operational -> degraded) only update the status row, matching
 * 55.17's specific concern (RPM unavailable), not general noise.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date();
  const bleStaleCutoff = new Date(now.getTime() - BLE_STALE_DAYS * 86_400_000).toISOString();
  const wearableStaleCutoff = new Date(now.getTime() - WEARABLE_STALE_DAYS * 86_400_000).toISOString();
  const recentlyPairedCutoff = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const recentlyConnectedCutoff = new Date(now.getTime() - 86_400_000).toISOString();

  const { data: previousStatus, error: statusError } = await supabase
    .from("integration_health_status")
    .select("component, state, consecutive_failures");
  if (statusError) {
    return Response.json({ error: statusError.message }, { status: 500 });
  }
  const previousStateByComponent = new Map((previousStatus ?? []).map((s) => [s.component, s.state]));
  const previousFailuresByComponent = new Map(
    (previousStatus ?? []).map((s) => [s.component, s.consecutive_failures])
  );

  const samples: { component: IntegrationComponent; sample: ComponentSample }[] = [];

  for (const [component, deviceType] of Object.entries(BLE_COMPONENTS) as [IntegrationComponent, PatientDeviceType][]) {
    const { data } = await supabase
      .from("patient_devices")
      .select("last_sync_error, last_synced_at, paired_at")
      .eq("device_type", deviceType)
      .eq("status", "active");
    const rows = data ?? [];
    // Only devices paired long enough to have had a real chance to sync
    // count toward the sample — a device paired an hour ago with no sync
    // yet is not a failure.
    const eligible = rows.filter((r) => r.paired_at < recentlyPairedCutoff);
    samples.push({
      component,
      sample: {
        total: eligible.length,
        errors: eligible.filter((r) => r.last_sync_error).length,
        stale: eligible.filter((r) => !r.last_synced_at || r.last_synced_at < bleStaleCutoff).length,
      },
    });
  }

  for (const [component, provider] of Object.entries(WEARABLE_COMPONENTS) as [IntegrationComponent, WearableProvider][]) {
    const { data } = await supabase
      .from("wearable_connections")
      .select("status, last_synced_at, connected_at")
      .eq("provider", provider)
      .in("status", ["active", "error"]);
    const rows = data ?? [];
    const eligible = rows.filter((r) => r.connected_at < recentlyConnectedCutoff);
    samples.push({
      component,
      sample: {
        total: eligible.length,
        errors: eligible.filter((r) => r.status === "error").length,
        stale: eligible.filter(
          (r) => r.status === "active" && (!r.last_synced_at || r.last_synced_at < wearableStaleCutoff)
        ).length,
      },
    });
  }

  // mobile_ingestion_api is the shared upload path behind every other
  // component — its sample is the union of all of them, so a systemic
  // problem (not one provider's own outage) shows up here specifically.
  const combined = samples.reduce(
    (acc, s) => ({
      total: acc.total + s.sample.total,
      errors: acc.errors + s.sample.errors,
      stale: acc.stale + s.sample.stale,
    }),
    { total: 0, errors: 0, stale: 0 }
  );
  samples.push({ component: "mobile_ingestion_api", sample: combined });

  const results: { component: string; state: IntegrationHealthState; transitioned: boolean }[] = [];

  for (const { component, sample } of samples) {
    const { state, note } = classify(sample);
    const previousState = previousStateByComponent.get(component);
    const previousFailures = previousFailuresByComponent.get(component) ?? 0;

    await supabase
      .from("integration_health_status")
      .update({
        state,
        last_checked_at: now.toISOString(),
        ...(state === "operational" ? { last_success_at: now.toISOString() } : {}),
        last_error: note,
        consecutive_failures: state === "operational" ? 0 : previousFailures + 1,
      })
      .eq("component", component);

    let transitioned = false;
    if (previousState !== "down" && state === "down") {
      await supabase.from("integration_incidents").insert({
        component,
        state: "down",
        detail: note,
      });
      transitioned = true;
    } else if (previousState === "down" && state !== "down") {
      const { data: openIncident } = await supabase
        .from("integration_incidents")
        .select("id")
        .eq("component", component)
        .is("resolved_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openIncident) {
        await supabase
          .from("integration_incidents")
          .update({ resolved_at: now.toISOString() })
          .eq("id", openIncident.id);
      }
      transitioned = true;
    }

    results.push({ component, state, transitioned });
  }

  return Response.json({ checkedAt: now.toISOString(), results });
}

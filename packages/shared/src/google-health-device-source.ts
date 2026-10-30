/**
 * GoogleHealthDeviceSource: a DOCUMENTED STUB, NOT WIRED (S70b).
 *
 * Why it exists: Google is ending the legacy Fitbit Web API (support ends 30 Sep 2026, turned off 30 Oct 2026; existing Fitbit tokens stop
 * working). Fitbit data moves to the Google Health API. This file holds the shape of that connector behind the DeviceSource interface so the
 * work has a place to start. It does NOT work, it is NOT registered in any DeviceSourceRegistry, no route, card or cron references it, and
 * every verb returns a refusal. It is deliberately NOT exported from the package index. Nothing may claim Fitbit or Google Health data flows
 * until a real implementation replaces this and has been run against a real account.
 *
 * Lead time (plan for it, do not assume it): the Google Health API scopes that read health data are classed "Restricted" by Google. Using a
 * restricted scope in production needs the app to pass Google's OAuth verification and a security assessment, which is a review on Google's
 * own timeline (plan for weeks to months, and it can need a yearly re-assessment). That review cannot be started from code; it needs the
 * company's verified Google Cloud project, a published privacy policy and a data-handling description. Confirm the current process on
 * Google's developer pages before promising a date (OQ-S70B-1).
 *
 * What a real implementation must do, in order:
 *   connect    OAuth 2.0 authorisation code flow against Google, asking only for the read scopes it needs, with the same signed state token
 *              the other cloud connectors use. `goLiveKey` is a platform_modules row born OFF.
 *   sync       pull a window of data with a stored, refreshed token (reuse the pattern in getValidAccessToken), page through results.
 *   normalise  map blood pressure, glucose, heart rate, SpO2, weight, steps and sleep to DeviceSourceReading. A wearable blood pressure is an
 *              ESTIMATE (docs/design/BP-wearable-estimates.md): it must arrive as `wearable`, never as a cuff reading.
 *   revoke     call Google's token revocation endpoint, delete the stored tokens, then mark the connection disconnected.
 * The ingestion boundary (plausibility, de-duplication, triage, source badge) is unchanged and applies to this source like any other.
 */
import type {
  DeviceConnectContext,
  DeviceConnectResult,
  DeviceRevokeResult,
  DeviceSource,
  DeviceSourceReading,
  DeviceSyncResult,
  DeviceSyncWindow,
} from "./device-source";

export const GOOGLE_HEALTH_SOURCE_ID = "google_health" as const;
/** The per-source go-live switch. NOT created by any migration yet: the row is added together with the real implementation. */
export const GOOGLE_HEALTH_GO_LIVE_KEY = "device_google_health" as const;

export const googleHealthDeviceSource: DeviceSource<unknown> = {
  id: GOOGLE_HEALTH_SOURCE_ID,
  kind: "vendor_cloud",
  goLiveKey: GOOGLE_HEALTH_GO_LIVE_KEY,

  async connect(_ctx: DeviceConnectContext): Promise<DeviceConnectResult> {
    return { ok: false, reason: "not_supported", error: "Google Health is not built yet. It needs Google's review of the restricted scopes first." };
  },

  async sync(_connection: unknown, _window: DeviceSyncWindow): Promise<DeviceSyncResult> {
    return { ok: false, code: "not_pullable", error: "Google Health is not built yet", retryable: false };
  },

  normalise(_raw: unknown): DeviceSourceReading[] {
    return [];
  },

  async revoke(_connection: unknown): Promise<DeviceRevokeResult> {
    return { ok: false, error: "Google Health is not built yet" };
  },
};

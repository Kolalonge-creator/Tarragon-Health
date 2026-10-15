import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DeviceConnectContext, DeviceConnectResult, DeviceRevokeResult, DeviceSource, DeviceSourceReading, DeviceSyncResult, DeviceSyncWindow } from "@tarragon/shared";
import { DeviceSourceRegistry } from "@tarragon/shared";
import { getValidAccessToken, type WearableConnectionCredentials } from "./connection-tokens";
import type { NormalisedReading } from "./normalise";
import { getWearableOAuthUrl, isWearableProviderConfigured, type CloudOAuthWearableProvider } from "./oauth-providers";
import { PROVIDER_ADAPTERS } from "./providers";

/**
 * The existing cloud wearable adapters, behind the DeviceSource interface (S70a). A refactor, not a new behaviour: each method does exactly
 * what the code it replaces did, in the same order, and the old call sites now go through it (pullConnection in ./sync.ts).
 *
 *   connect    getWearableOAuthUrl (the same authorize URL the Connect route builds); `not_configured` while no developer credentials exist
 *   sync       the stored token (refreshed when needed), then the adapter's windowed read
 *   normalise  the adapter's inline reader (Garmin pushes its summaries in the webhook body); other providers need a fetch, so they give []
 *   revoke     the existing revoke_wearable_connection function, run as the person
 *
 * No per-connector go-live key: the Connect card has been live and ungated since 2026-07-31, and gating it now would switch off a working
 * feature for patients who may already use it. Recorded as OQ-372. New connectors (S70b) are born with a key.
 */
export type WearableDeviceSource = DeviceSource<WearableConnectionCredentials>;

const asReadings = (list: NormalisedReading[]): DeviceSourceReading[] =>
  list.map((r) => ({
    readingType: r.readingType,
    value: r.value,
    ...(r.secondaryValue !== undefined ? { secondaryValue: r.secondaryValue } : {}),
    unit: r.unit,
    recordedAt: r.recordedAt,
    externalReadingId: r.externalReadingId,
  }));

export function cloudDeviceSource(provider: CloudOAuthWearableProvider, svc: SupabaseClient<Database>): WearableDeviceSource {
  const adapter = PROVIDER_ADAPTERS[provider];
  return {
    id: provider,
    kind: "vendor_cloud",
    goLiveKey: null,

    async connect(ctx: DeviceConnectContext): Promise<DeviceConnectResult> {
      if (!isWearableProviderConfigured(provider)) return { ok: false, reason: "not_configured", error: `${provider} has no developer credentials yet` };
      if (!ctx.redirectUri || !ctx.state) return { ok: false, reason: "failed", error: "a return address and a state token are needed" };
      const url = getWearableOAuthUrl(provider, ctx.redirectUri, ctx.state);
      return url.ok ? { ok: true, kind: "redirect", url: url.url } : { ok: false, reason: "not_configured", error: url.error };
    },

    async sync(connection: WearableConnectionCredentials, window: DeviceSyncWindow): Promise<DeviceSyncResult> {
      if (!adapter.fetchSince) return { ok: false, code: "not_pullable", error: `${provider} is not pulled, it pushes`, retryable: false };
      const token = await getValidAccessToken(svc, connection);
      if (!token.ok) return { ok: false, code: "no_token", error: token.error, retryable: true };
      try {
        return { ok: true, readings: asReadings(await adapter.fetchSince(token.accessToken, window.since, window.until)) };
      } catch (error) {
        return { ok: false, code: "provider_error", error: error instanceof Error ? error.message : "provider read failed", retryable: true, cause: error };
      }
    },

    normalise(raw: unknown): DeviceSourceReading[] {
      if (!adapter.readInline) return [];
      try {
        return adapter.readInline(raw).flatMap((group) => asReadings(group.readings));
      } catch {
        return [];
      }
    },

    async revoke(connection: WearableConnectionCredentials): Promise<DeviceRevokeResult> {
      const { error } = await svc.rpc("revoke_wearable_connection", { p_connection_id: connection.id });
      return error ? { ok: false, error: error.message } : { ok: true };
    },
  };
}

export const CLOUD_PROVIDERS = Object.keys(PROVIDER_ADAPTERS) as CloudOAuthWearableProvider[];

export function buildWearableSourceRegistry(svc: SupabaseClient<Database>): DeviceSourceRegistry<WearableConnectionCredentials> {
  const registry = new DeviceSourceRegistry<WearableConnectionCredentials>();
  for (const provider of CLOUD_PROVIDERS) registry.register(cloudDeviceSource(provider, svc));
  return registry;
}

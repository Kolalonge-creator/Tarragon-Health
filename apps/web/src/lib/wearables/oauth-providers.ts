/**
 * Consumer wearable cloud sync — OAuth authorization-URL builder for the
 * server-side-OAuth providers (Oura, WHOOP, Garmin, Fitbit). CLAUDE.md
 * "Device & Wearable Integration": Phase 3, diaspora/premium tier, not yet
 * built — this is the reusable piece that can be built and tested now,
 * ahead of registering real developer apps with each provider.
 *
 * Apple Health is deliberately excluded from this module: it has no cloud
 * OAuth API at all. HealthKit data only exists on-device and syncing it
 * requires the Expo mobile app's own HealthKit bridge (the same
 * ingestion-boundary shape as the Bluetooth BP-cuff/glucometer pairing in
 * apps/mobile, not a server-side redirect flow) — so it isn't a
 * CloudOAuthWearableProvider and doesn't belong in this module.
 *
 * Same graceful-degradation contract as lib/stripe/client.ts and
 * lib/paystack/client.ts: never throws, returns `{ ok: false, error }` when
 * the provider's client ID/secret env vars aren't set, so this stays
 * completely inert (not half-built, not crashing) until real credentials
 * are registered with each provider.
 */

/**
 * "libre" (Abbott/LibreView) is deliberately NOT in this union, for the same
 * reason Apple Health is excluded (see the module doc comment above): Abbott
 * has no public self-serve OAuth developer program — real-world Libre data
 * access requires a direct partnership/data-sharing agreement with Abbott,
 * not an app registration. It still exists as a `wearable_provider` DB enum
 * value for schema completeness, but the patient-facing card shows it as
 * "requires a partnership" rather than a Connect button — building a fake
 * OAuth flow for it would misrepresent the real integration path.
 */
export type CloudOAuthWearableProvider = "oura" | "whoop" | "garmin" | "fitbit" | "dexcom";

interface OAuthProviderConfig {
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  authorizeUrl: string;
  scope: string;
}

const OAUTH_PROVIDER_CONFIG: Record<CloudOAuthWearableProvider, OAuthProviderConfig> = {
  oura: {
    clientIdEnvVar: "OURA_CLIENT_ID",
    clientSecretEnvVar: "OURA_CLIENT_SECRET",
    authorizeUrl: "https://cloud.ouraring.com/oauth/authorize",
    scope: "daily heartrate workout",
  },
  // Dexcom's real, official developer OAuth2 program (developer.dexcom.com).
  // `offline_access` is required by Dexcom to receive a refresh_token — the
  // 4 other providers' scopes are all read-data scopes with no analogue to
  // this one, so it can't be omitted the way an empty scope (Garmin) can.
  dexcom: {
    clientIdEnvVar: "DEXCOM_CLIENT_ID",
    clientSecretEnvVar: "DEXCOM_CLIENT_SECRET",
    authorizeUrl: "https://api.dexcom.com/v2/oauth2/login",
    scope: "offline_access",
  },
  whoop: {
    clientIdEnvVar: "WHOOP_CLIENT_ID",
    clientSecretEnvVar: "WHOOP_CLIENT_SECRET",
    authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
    scope: "read:recovery read:cycles read:sleep read:workout",
  },
  garmin: {
    clientIdEnvVar: "GARMIN_CLIENT_ID",
    clientSecretEnvVar: "GARMIN_CLIENT_SECRET",
    authorizeUrl: "https://connect.garmin.com/oauth2Confirm",
    scope: "",
  },
  fitbit: {
    clientIdEnvVar: "FITBIT_CLIENT_ID",
    clientSecretEnvVar: "FITBIT_CLIENT_SECRET",
    authorizeUrl: "https://www.fitbit.com/oauth2/authorize",
    scope: "activity heartrate sleep weight",
  },
};

/**
 * Providers that must not be OFFERED for a new connection, by configuration and not by deleting code (S70b).
 *
 * Fitbit: Google is ending the legacy Fitbit Web API (support ends 30 Sep 2026, turned off 30 Oct 2026; existing tokens stop working). The
 * replacement, the Google Health API, uses scopes Google marks "Restricted" that need a review before any production use (see
 * packages/shared/src/google-health-device-source.ts). Until that exists a new Fitbit connection would work for days and then silently stop,
 * which is worse than saying so. Existing rows and the readings already synced stay readable; only starting a NEW connection is refused.
 *
 * The list comes from env `WEARABLE_UNAVAILABLE_PROVIDERS` (comma separated provider names) when that is set, so it can be changed without a
 * deploy of code; unset, it defaults to "fitbit". Set it to an empty string to offer every configured provider again. An unknown name is ignored.
 */
export const DEFAULT_UNAVAILABLE_WEARABLE_PROVIDERS: readonly CloudOAuthWearableProvider[] = ["fitbit"];

export function unavailableWearableProviders(env: Record<string, string | undefined> = process.env): CloudOAuthWearableProvider[] {
  const raw = env.WEARABLE_UNAVAILABLE_PROVIDERS;
  const known = Object.keys(OAUTH_PROVIDER_CONFIG) as CloudOAuthWearableProvider[];
  if (raw === undefined) return [...DEFAULT_UNAVAILABLE_WEARABLE_PROVIDERS];
  return raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is CloudOAuthWearableProvider => (known as string[]).includes(p));
}

export function isWearableProviderUnavailable(provider: CloudOAuthWearableProvider, env: Record<string, string | undefined> = process.env): boolean {
  return unavailableWearableProviders(env).includes(provider);
}

/** True when a NEW connection may be started: credentials exist AND the provider is not switched off. */
export function isWearableProviderConnectable(provider: CloudOAuthWearableProvider): boolean {
  return isWearableProviderConfigured(provider) && !isWearableProviderUnavailable(provider);
}

export function isWearableProviderConfigured(provider: CloudOAuthWearableProvider): boolean {
  const config = OAUTH_PROVIDER_CONFIG[provider];
  return Boolean(process.env[config.clientIdEnvVar] && process.env[config.clientSecretEnvVar]);
}

export interface WearableClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * The one place that resolves a provider's client ID/secret from the
 * environment. The token exchange, the refresh grant and the webhook
 * signature check all need the same pair, and each having its own copy of
 * the env var names is how one of them ends up reading a variable nobody
 * sets. Returns null (never throws, never partially-configured) unless both
 * halves are present.
 */
export function getWearableClientCredentials(
  provider: CloudOAuthWearableProvider
): WearableClientCredentials | null {
  const config = OAUTH_PROVIDER_CONFIG[provider];
  const clientId = process.env[config.clientIdEnvVar];
  const clientSecret = process.env[config.clientSecretEnvVar];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** For error messages that need to name the missing variable. */
export function wearableCredentialEnvVars(
  provider: CloudOAuthWearableProvider
): [string, string] {
  const config = OAUTH_PROVIDER_CONFIG[provider];
  return [config.clientIdEnvVar, config.clientSecretEnvVar];
}

export type WearableOAuthResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Builds the provider's authorization redirect URL. `state` should be an
 * unguessable per-request token the caller verifies on callback (CSRF
 * protection) — this function doesn't generate or persist it, only embeds
 * whatever the caller passes in.
 */
export function getWearableOAuthUrl(
  provider: CloudOAuthWearableProvider,
  redirectUri: string,
  state: string
): WearableOAuthResult {
  const config = OAUTH_PROVIDER_CONFIG[provider];
  const clientId = process.env[config.clientIdEnvVar];
  if (!clientId) {
    return { ok: false, error: `${config.clientIdEnvVar} is not configured` };
  }

  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (config.scope) {
    url.searchParams.set("scope", config.scope);
  }
  return { ok: true, url: url.toString() };
}

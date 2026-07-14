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

export type CloudOAuthWearableProvider = "oura" | "whoop" | "garmin" | "fitbit";

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

export function isWearableProviderConfigured(provider: CloudOAuthWearableProvider): boolean {
  const config = OAUTH_PROVIDER_CONFIG[provider];
  return Boolean(process.env[config.clientIdEnvVar] && process.env[config.clientSecretEnvVar]);
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

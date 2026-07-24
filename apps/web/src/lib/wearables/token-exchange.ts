import "server-only";
import type { CloudOAuthWearableProvider } from "./oauth-providers";

/**
 * Standard OAuth2 authorization_code token exchange, one endpoint per
 * provider. Same graceful-degradation contract as oauth-providers.ts and
 * lib/stripe/client.ts: never throws, returns {ok:false, error} when the
 * provider's client ID/secret aren't configured — this module stays inert
 * until real developer-app credentials exist for each provider.
 *
 * CAVEAT: exact request shape (Basic-auth header vs. body params, response
 * field names) is written to each provider's documented OAuth2 flow from
 * training knowledge, not verified against a live sandbox (none of the 4
 * providers' real developer apps exist yet, per CLAUDE.md). Garmin in
 * particular has historically used OAuth 1.0a rather than OAuth2 for its
 * older Connect API — this follows oauth-providers.ts's existing
 * (already-committed) choice to model it as a simple OAuth2 redirect
 * rather than relitigating that decision here. Verify against each
 * provider's current docs once a real developer account is registered.
 */

interface TokenEndpointConfig {
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  tokenUrl: string;
}

const TOKEN_ENDPOINT_CONFIG: Record<CloudOAuthWearableProvider, TokenEndpointConfig> = {
  oura: {
    clientIdEnvVar: "OURA_CLIENT_ID",
    clientSecretEnvVar: "OURA_CLIENT_SECRET",
    tokenUrl: "https://api.ouraring.com/oauth/token",
  },
  whoop: {
    clientIdEnvVar: "WHOOP_CLIENT_ID",
    clientSecretEnvVar: "WHOOP_CLIENT_SECRET",
    tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
  },
  garmin: {
    clientIdEnvVar: "GARMIN_CLIENT_ID",
    clientSecretEnvVar: "GARMIN_CLIENT_SECRET",
    tokenUrl: "https://connectapi.garmin.com/oauth-service/oauth/token",
  },
  fitbit: {
    clientIdEnvVar: "FITBIT_CLIENT_ID",
    clientSecretEnvVar: "FITBIT_CLIENT_SECRET",
    tokenUrl: "https://api.fitbit.com/oauth2/token",
  },
};

export type TokenExchangeResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      expiresInSeconds: number | null;
      externalId: string | null;
    }
  | { ok: false; error: string };

export async function exchangeWearableOAuthCode(
  provider: CloudOAuthWearableProvider,
  code: string,
  redirectUri: string
): Promise<TokenExchangeResult> {
  const config = TOKEN_ENDPOINT_CONFIG[provider];
  const clientId = process.env[config.clientIdEnvVar];
  const clientSecret = process.env[config.clientSecretEnvVar];
  if (!clientId || !clientSecret) {
    return { ok: false, error: `${config.clientIdEnvVar}/${config.clientSecretEnvVar} not configured` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(config.tokenUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Token exchange failed: HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user_id?: string;
      athlete_id?: string;
    };
    if (!data.access_token) {
      return { ok: false, error: "Provider response had no access_token" };
    }
    return {
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresInSeconds: data.expires_in ?? null,
      externalId: data.user_id ?? data.athlete_id ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

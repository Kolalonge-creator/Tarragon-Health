import "server-only";
import {
  getWearableClientCredentials,
  wearableCredentialEnvVars,
  type CloudOAuthWearableProvider,
} from "./oauth-providers";

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

const TOKEN_URL: Record<CloudOAuthWearableProvider, string> = {
  oura: "https://api.ouraring.com/oauth/token",
  dexcom: "https://api.dexcom.com/v2/oauth2/token",
  whoop: "https://api.prod.whoop.com/oauth/oauth2/token",
  garmin: "https://connectapi.garmin.com/oauth-service/oauth/token",
  fitbit: "https://api.fitbit.com/oauth2/token",
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

/** Shared POST against a provider's OAuth2 token endpoint. Both grants
 * (authorization_code, refresh_token) use the same Basic-auth + form-encoded
 * shape and the same response fields, so they differ only in the form body. */
async function postTokenGrant(
  provider: CloudOAuthWearableProvider,
  body: Record<string, string>
): Promise<TokenExchangeResult> {
  const credentials = getWearableClientCredentials(provider);
  if (!credentials) {
    const [idVar, secretVar] = wearableCredentialEnvVars(provider);
    return { ok: false, error: `${idVar}/${secretVar} not configured` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL[provider], {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams(body),
    });
    if (!res.ok) {
      return { ok: false, error: `Token request failed: HTTP ${res.status}` };
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

export async function exchangeWearableOAuthCode(
  provider: CloudOAuthWearableProvider,
  code: string,
  redirectUri: string
): Promise<TokenExchangeResult> {
  return postTokenGrant(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

/**
 * Refresh grant. Every one of these providers issues a short-lived access
 * token (Fitbit 8h, WHOOP 1h, Oura 24h, Dexcom 2h), so without this the
 * whole pull path works for exactly one token lifetime after a patient
 * connects and then goes quiet — the failure mode being an endless stream of
 * 401s nobody sees. Note that some providers (Fitbit, Dexcom) rotate the
 * refresh token on every use and invalidate the old one, which is why the
 * caller must persist `refreshToken` from the response whenever it is
 * non-null rather than assuming the stored one stays valid.
 */
export async function refreshWearableAccessToken(
  provider: CloudOAuthWearableProvider,
  refreshToken: string
): Promise<TokenExchangeResult> {
  return postTokenGrant(provider, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

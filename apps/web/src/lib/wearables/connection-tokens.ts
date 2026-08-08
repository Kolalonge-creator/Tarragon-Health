import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { refreshWearableAccessToken } from "./token-exchange";
import type { CloudOAuthWearableProvider } from "./oauth-providers";

/**
 * Access-token custody for a stored wearable connection: hand back a token
 * that is valid *right now*, refreshing and re-persisting it when it isn't.
 *
 * Kept separate from token-exchange.ts on purpose — that module is a pure
 * HTTP client with no database knowledge, this one is the only place that
 * writes tokens back to wearable_connections. It always runs under the
 * service-role client: the token columns are not readable by `authenticated`
 * at all (see the 20260808023332 migration), and the enforce_column_scope
 * trigger rejects a token write from any other role.
 */

/** The columns any ingestion path needs to talk to a provider on a
 * connection's behalf. Deliberately explicit rather than Tables<> — this is
 * the shape callers must select, and `select("*")` would pull tokens into
 * places that have no business holding them. */
export interface WearableConnectionCredentials {
  id: string;
  organisation_id: string;
  patient_id: string;
  provider: CloudOAuthWearableProvider;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

export const WEARABLE_CREDENTIAL_COLUMNS =
  "id, organisation_id, patient_id, provider, access_token, refresh_token, token_expires_at";

/** Refresh this far ahead of the stated expiry so a token doesn't lapse
 * mid-request between the check and the provider call. */
const EXPIRY_SKEW_MS = 60_000;

export type AccessTokenResult = { ok: true; accessToken: string } | { ok: false; error: string };

export async function getValidAccessToken(
  svc: SupabaseClient<Database>,
  connection: WearableConnectionCredentials
): Promise<AccessTokenResult> {
  const expiresAt = connection.token_expires_at ? Date.parse(connection.token_expires_at) : null;
  const stillValid =
    connection.access_token !== null &&
    (expiresAt === null || Number.isNaN(expiresAt) || expiresAt - EXPIRY_SKEW_MS > Date.now());

  if (stillValid && connection.access_token) {
    return { ok: true, accessToken: connection.access_token };
  }

  if (!connection.refresh_token) {
    // Expired with nothing to refresh from: the connection is dead and the
    // patient has to reconnect. Record it so it's visible rather than just
    // permanently silent.
    await markConnectionError(svc, connection.id, "Access token expired and no refresh token is stored");
    return { ok: false, error: "no refresh token" };
  }

  const refreshed = await refreshWearableAccessToken(connection.provider, connection.refresh_token);
  if (!refreshed.ok) {
    await markConnectionError(svc, connection.id, `Token refresh failed: ${refreshed.error}`);
    return { ok: false, error: refreshed.error };
  }

  const newExpiry = refreshed.expiresInSeconds
    ? new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString()
    : null;

  await svc
    .from("wearable_connections")
    .update({
      access_token: refreshed.accessToken,
      // Fitbit and Dexcom rotate the refresh token on use and invalidate the
      // previous one, so a null here means "provider didn't rotate", not
      // "clear the stored one" — keeping the old value would break the next
      // refresh for the rotating providers.
      refresh_token: refreshed.refreshToken ?? connection.refresh_token,
      token_expires_at: newExpiry,
      last_sync_error: null,
    })
    .eq("id", connection.id);

  return { ok: true, accessToken: refreshed.accessToken };
}

/** A connection that can no longer talk to its provider is marked `error`,
 * not `disconnected` — disconnected means the patient chose to unlink, and
 * conflating the two would make a revoked token look like a deliberate
 * choice on the patient's dashboard. */
export async function markConnectionError(
  svc: SupabaseClient<Database>,
  connectionId: string,
  message: string
): Promise<void> {
  await svc
    .from("wearable_connections")
    .update({ status: "error", last_sync_error: message.slice(0, 500) })
    .eq("id", connectionId);
}

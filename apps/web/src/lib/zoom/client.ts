/**
 * Server-only Zoom REST client. Never import this from a "use client" file
 * — it holds ZOOM_CLIENT_SECRET.
 *
 * Auth is Server-to-Server OAuth (Zoom's current recommendation for a
 * backend that creates meetings with no interactive user consent — the
 * older JWT app type is deprecated). A long-lived server credential
 * (account_id + client_id + client_secret) is token-exchanged per call;
 * the resulting access token is short-lived and cached in memory only for
 * this process's lifetime, never persisted.
 *
 * Same never-throw contract as packages/shared/src/ml-client.ts and
 * lib/paystack/client.ts: any network error, timeout, non-2xx, or
 * malformed JSON resolves to `{ ok: false, error }` rather than throwing.
 */

const ZOOM_OAUTH_URL = "https://zoom.us/oauth/token";
const ZOOM_API_BASE_URL = "https://api.zoom.us/v2";
const DEFAULT_TIMEOUT_MS = 10_000;

export type ZoomResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

function getCredentials(): { accountId: string; clientId: string; clientSecret: string } | null {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) return null;
  return { accountId, clientId, clientSecret };
}

/** True once all three Zoom Server-to-Server OAuth credentials are configured — callers use this to decide whether to offer a video option at all. */
export function isZoomConfigured(): boolean {
  return getCredentials() !== null;
}

async function getAccessToken(): Promise<ZoomResult<string>> {
  const credentials = getCredentials();
  if (!credentials) {
    return { ok: false, error: "Zoom credentials are not configured" };
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return { ok: true, data: cachedToken.accessToken };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
    const response = await fetch(
      `${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${credentials.accountId}`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${basicAuth}` },
        signal: controller.signal,
      }
    );
    const json = (await response.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error?: string }
      | null;

    if (!response.ok || !json?.access_token) {
      return { ok: false, error: json?.error ?? `Zoom OAuth token request failed with status ${response.status}` };
    }

    cachedToken = {
      accessToken: json.access_token,
      // Refresh a little early rather than racing the real expiry.
      expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
    };
    return { ok: true, data: json.access_token };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown Zoom OAuth failure" };
  } finally {
    clearTimeout(timer);
  }
}

export async function zoomFetch<T>(
  path: string,
  init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }
): Promise<ZoomResult<T>> {
  const tokenResult = await getAccessToken();
  if (!tokenResult.ok) return tokenResult;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${ZOOM_API_BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${tokenResult.data}`,
        "Content-Type": "application/json",
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    if (response.status === 204) {
      return { ok: true, data: undefined as T };
    }

    const json = (await response.json().catch(() => null)) as T | { message?: string } | null;

    if (!response.ok) {
      const message = json && typeof json === "object" && "message" in json ? json.message : undefined;
      return { ok: false, error: message ?? `Zoom request failed with status ${response.status}` };
    }

    return { ok: true, data: json as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown Zoom request failure" };
  } finally {
    clearTimeout(timer);
  }
}

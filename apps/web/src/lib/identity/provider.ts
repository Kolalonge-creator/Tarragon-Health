import "server-only";

/**
 * Identity-verification (KYC) provider boundary.
 *
 * A small registry of provider adapters keyed by IDENTITY_PROVIDER. When no
 * provider is configured the boundary degrades gracefully (returns
 * `unavailable`): the caller still records the request as `pending`, so the
 * control never clicks through to nothing (same posture as the wearable OAuth
 * scaffolding). Every adapter follows the same never-throw, 5s-timeout,
 * graceful-fallback contract as packages/shared/ml-client.ts.
 *
 * Configured provider (env):
 *   IDENTITY_PROVIDER   e.g. "dojah" — selects the adapter
 *   IDENTITY_API_KEY    the provider secret key
 *   IDENTITY_APP_ID     provider app id (Dojah AppId header)
 *   IDENTITY_BASE_URL   optional host override (e.g. the sandbox host)
 */

export type IdentityMethod = "nin" | "bvn";

export type VerifyIdentityResult =
  | { ok: true; verified: boolean; provider: string; reference: string | null }
  | { ok: false; reason: "unavailable" | "error" };

interface ProviderAdapter {
  /** True when this adapter has every credential it needs. */
  isConfigured(): boolean;
  verify(method: IdentityMethod, idNumber: string): Promise<VerifyIdentityResult>;
}

const REQUEST_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dojah (https://dojah.io) — Nigerian KYC lookup.
 *   NIN: GET {base}/api/v1/kyc/nin?nin={n}
 *   BVN: GET {base}/api/v1/kyc/bvn?bvn={n}
 * Headers: AppId, Authorization (the secret key — not a Bearer token).
 * Success is 200 with a top-level `entity` object; a 4xx means the number
 * didn't resolve (a definitive "not verified", not an integration error).
 * Base URL defaults to production; set IDENTITY_BASE_URL to the sandbox host
 * (https://sandbox.dojah.io) for test credentials.
 */
const dojah: ProviderAdapter = {
  isConfigured() {
    return Boolean(process.env.IDENTITY_API_KEY && process.env.IDENTITY_APP_ID);
  },
  async verify(method, idNumber) {
    const base = process.env.IDENTITY_BASE_URL || "https://api.dojah.io";
    const path = method === "bvn" ? "bvn" : "nin";
    const url = `${base}/api/v1/kyc/${path}?${method}=${encodeURIComponent(idNumber)}`;
    try {
      const res = await fetchWithTimeout(url, {
        method: "GET",
        headers: {
          AppId: process.env.IDENTITY_APP_ID as string,
          Authorization: process.env.IDENTITY_API_KEY as string,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          return { ok: true, verified: false, provider: "dojah", reference: null };
        }
        return { ok: false, reason: "error" };
      }
      const body = (await res.json()) as { entity?: Record<string, unknown> };
      const entity = body.entity;
      if (!entity) {
        return { ok: true, verified: false, provider: "dojah", reference: null };
      }
      const raw = entity[method];
      const reference = typeof raw === "string" ? raw : null;
      return { ok: true, verified: true, provider: "dojah", reference };
    } catch {
      return { ok: false, reason: "error" };
    }
  },
};

const ADAPTERS: Record<string, ProviderAdapter> = {
  dojah,
};

function activeAdapter(): ProviderAdapter | null {
  const provider = process.env.IDENTITY_PROVIDER?.toLowerCase();
  if (!provider) return null;
  const adapter = ADAPTERS[provider];
  if (!adapter || !adapter.isConfigured()) return null;
  return adapter;
}

export function isIdentityVerificationConfigured(): boolean {
  return activeAdapter() !== null;
}

/**
 * Attempt to verify an identity document. Never throws. Returns `unavailable`
 * when no provider is configured; otherwise delegates to the active adapter,
 * which returns a definitive verified/not-verified answer or an `error` if the
 * provider couldn't be reached.
 */
export async function verifyIdentity(
  method: IdentityMethod,
  idNumber: string,
): Promise<VerifyIdentityResult> {
  const adapter = activeAdapter();
  if (!adapter) {
    return { ok: false, reason: "unavailable" };
  }
  return adapter.verify(method, idNumber);
}

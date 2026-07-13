/**
 * Server-only Paystack REST client (NGN payments — see CLAUDE.md "Payments:
 * Paystack (NGN)"). Never import this from a "use client" file — it holds
 * PAYSTACK_SECRET_KEY.
 *
 * Same never-throw contract as packages/shared/src/ml-client.ts: any
 * network error, timeout, non-2xx, or malformed JSON resolves to
 * `{ ok: false, error }` rather than throwing, so callers always have to
 * handle the failure path explicitly instead of relying on a try/catch that
 * might get forgotten around a money-moving call.
 */

const PAYSTACK_BASE_URL = "https://api.paystack.co";
const DEFAULT_TIMEOUT_MS = 10_000;

export type PaystackResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

function getSecretKey(): string | null {
  return process.env.PAYSTACK_SECRET_KEY || null;
}

/** True once PAYSTACK_SECRET_KEY is configured — callers use this to decide
 * whether to attempt a checkout at all, same pattern as
 * createMlClientFromEnv() returning null when unconfigured. */
export function isPaystackConfigured(): boolean {
  return getSecretKey() !== null;
}

export async function paystackFetch<T>(
  path: string,
  init?: { method?: "GET" | "POST" | "PUT"; body?: unknown },
): Promise<PaystackResult<T>> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    return { ok: false, error: "PAYSTACK_SECRET_KEY is not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    const json = (await response.json().catch(() => null)) as PaystackEnvelope<T> | null;

    if (!response.ok || !json) {
      return {
        ok: false,
        error: json?.message ?? `Paystack request failed with status ${response.status}`,
      };
    }
    if (!json.status) {
      return { ok: false, error: json.message || "Paystack reported an error" };
    }

    return { ok: true, data: json.data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Paystack request failure",
    };
  } finally {
    clearTimeout(timer);
  }
}

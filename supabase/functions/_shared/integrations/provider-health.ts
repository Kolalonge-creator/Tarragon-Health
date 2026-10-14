import { asObject } from "./http.ts";
import type { EmailProvider } from "./email.ts";
import type { PaymentProvider } from "./payment.ts";
import { fail, ok, type ProviderErrorCode, type ProviderResult } from "./result.ts";

/**
 * Provider circuit breaker (S14x, plan item R6). After `failureThreshold` consecutive outages the breaker opens and callers stop
 * calling the provider for `openSeconds`, then ONE probe is let through (half open): a good probe closes it, a bad one re-opens it.
 * The state lives in the database (`provider_health`, via `provider_call_allowed` / `provider_record_result`) because an edge
 * function instance is short lived; `provider_health_v` is what the chain-health page reads. There is no second provider to fail over
 * to (founder decision), so the point is to stop hammering a dead one, to fail fast with a clear code, and to tell a person.
 *
 * Rules that keep the breaker from being the problem:
 *  - It fails OPEN. If the health store cannot be reached the call goes ahead, as if no breaker existed.
 *  - Only outages count (network, timeout, 5xx/429, a malformed reply, a rejected key). A customer's bad input, a duplicate
 *    reference, a blocked patient email or a suppressed address is the provider working, and counts as a success.
 *  - Money safety is not weakened: an open breaker means "not made", never "made and unknown". The call was not sent.
 */
export interface HealthStore {
  allowed(provider: string, operation: string): Promise<ProviderResult<{ readonly allowed: boolean; readonly state: string }>>;
  record(provider: string, operation: string, succeeded: boolean, errorCode?: string): Promise<ProviderResult<string>>;
}

const OUTAGE: ReadonlySet<ProviderErrorCode> = new Set(["network", "timeout", "vendor_error", "bad_response", "unauthorized"]);

/** True when this failure says the provider (or our access to it) is down, rather than that this one request was wrong. */
export const countsAsOutage = (code: ProviderErrorCode): boolean => OUTAGE.has(code);

export async function guardedCall<T>(
  health: HealthStore | null,
  provider: string,
  operation: string,
  call: () => Promise<ProviderResult<T>>,
): Promise<ProviderResult<T>> {
  if (!health) return await call();
  const gate = await health.allowed(provider, operation);
  if (gate.ok && !gate.data.allowed) return fail("circuit_open", `${provider} ${operation} is paused after repeated failures`, true);
  const result = await call();
  await health.record(provider, operation, result.ok || !countsAsOutage(result.error.code), result.ok ? undefined : result.error.code);
  return result;
}

/** A payment provider whose checkout initialisation is guarded. Everything else passes straight through (a refund or a transfer must never be skipped by a breaker). */
export function withPaymentBreaker(payment: PaymentProvider, health: HealthStore | null): PaymentProvider {
  if (!health) return payment;
  return { ...payment, initializeTransaction: (input) => guardedCall(health, "paystack", "initialize", () => payment.initializeTransaction(input)) };
}

/** An email provider whose sends are guarded. */
export function withEmailBreaker(email: EmailProvider, health: HealthStore | null): EmailProvider {
  if (!health) return email;
  return { ...email, send: (input) => guardedCall(health, "resend", "send", () => email.send(input)) };
}

export interface HealthRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function supabaseHealthStore(client: HealthRpcClient): HealthStore {
  return {
    async allowed(provider, operation) {
      try {
        const { data, error } = await client.rpc("provider_call_allowed", { p_provider: provider, p_operation: operation });
        const d = asObject(data);
        if (error || !d || typeof d["allowed"] !== "boolean") return fail("vendor_error", "provider_call_allowed failed", true);
        return ok({ allowed: d["allowed"], state: typeof d["state"] === "string" ? d["state"] : "closed" });
      } catch {
        return fail("network", "provider_call_allowed could not be reached");
      }
    },
    async record(provider, operation, succeeded, errorCode) {
      try {
        const { data, error } = await client.rpc("provider_record_result", { p_provider: provider, p_operation: operation, p_ok: succeeded, p_error_code: errorCode ?? null });
        return error ? fail("vendor_error", "provider_record_result failed", true) : ok(typeof data === "string" ? data : "unknown");
      } catch {
        return fail("network", "provider_record_result could not be reached");
      }
    },
  };
}

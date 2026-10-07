/**
 * Shared result type for every vendor adapter (S14, spec section 3.1 and 10). Same never-throw contract as
 * `packages/shared/src/ml-client.ts`: a network failure, timeout, bad JSON or a vendor error is a value, never an
 * exception, so a caller cannot forget a try/catch around a call that moves money or opens a consultation.
 * Plain TypeScript, no Node or Deno globals, so web code, the console and edge functions share one copy.
 */
export type ProviderErrorCode =
  | "not_configured"
  | "invalid_input"
  | "network"
  | "timeout"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "vendor_error"
  | "bad_response"
  | "consent_required"
  | "blocked_content"
  | "suppressed"
  | "unsupported"
  | "invalid_signature"
  /** A genuine, correctly signed event that arrived outside the replay window. Its signature held, so it is not an attack: callers acknowledge it. */
  | "stale_event";

export interface ProviderError {
  readonly code: ProviderErrorCode;
  /** Short and free of secrets, addresses, transcript text and patient detail. */
  readonly message: string;
  /** True when the same call may succeed if repeated (network, timeout, 429, 5xx). */
  readonly retryable: boolean;
}

export type ProviderResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ProviderError };

export const ok = <T>(data: T): ProviderResult<T> => ({ ok: true, data });

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set(["network", "timeout"]);

export function fail(code: ProviderErrorCode, message: string, retryable: boolean = RETRYABLE.has(code)): ProviderResult<never> {
  return { ok: false, error: { code, message: message.slice(0, 200), retryable } };
}

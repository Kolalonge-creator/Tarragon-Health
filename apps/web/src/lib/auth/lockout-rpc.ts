import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Thin wrapper around a Supabase RPC call that reports a failure to Sentry
 * instead of silently swallowing it — for the class of call site that must
 * stay best-effort (never block a real login/checkout on a transient
 * failure) but where a PERSISTENT failure (e.g. a lost EXECUTE grant) should
 * still be discoverable rather than looking identical to "nothing happened."
 *
 * Found in pre-merge review: every one of this codebase's auth-adjacent RPC
 * call sites (the account-lockout checks/writes, and separately
 * record-login-device.ts's new-device notification) caught a THROWN
 * exception but never inspected the resolved `{data, error}` shape
 * supabase-js actually returns on a PostgREST-level failure (permission
 * denied, wrong signature) — which never throws. If the relevant EXECUTE
 * grant were ever accidentally lost — this exact codebase's own CLAUDE.md
 * documents that precise regression class recurring five separate times for
 * other functions ("Supabase anon-execute gotcha") — the feature would fail
 * open/silent platform-wide with nothing logged. This does not change the
 * fail-open behaviour itself (a lockout check must never block a real
 * login, a device-notification failure must never block a real sign-in) —
 * it only makes the failure discoverable. `Sentry.captureMessage` is a safe
 * no-op when SENTRY_DSN is unset (Sentry.init() is never called in that
 * case — see sentry.server.config.ts), so this carries no cost in an
 * environment without Sentry configured.
 *
 * `T` is supplied explicitly by the caller (matching the RPC's real return
 * type) rather than derived from `Database["public"]["Functions"]`: several
 * callers of this (clear_login_failures, record_login_device with a fixed
 * 3-argument shape) don't compose cleanly with one generic `args` parameter
 * shared across every RPC name a caller might pass — every zero-argument
 * call site in this codebase already calls its RPC with no second argument,
 * matched below by `args` being optional.
 */
export async function callRpc<T = unknown>(
  supabase: SupabaseClient<Database>,
  fn: keyof Database["public"]["Functions"],
  args?: Record<string, unknown>
): Promise<T | null> {
  try {
    const result = args
      ? await supabase.rpc(fn as never, args as never)
      : await supabase.rpc(fn as never);
    if (result.error) {
      Sentry.captureMessage(`RPC "${fn}" returned an error`, {
        level: "error",
        extra: { fn, error: result.error },
      });
      return null;
    }
    return result.data as T;
  } catch (error) {
    Sentry.captureMessage(`RPC "${fn}" threw`, {
      level: "error",
      extra: { fn, error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

type LockoutRpcName =
  | "is_account_locked"
  | "is_account_locked_by_phone"
  | "record_failed_login"
  | "record_failed_login_by_phone"
  | "clear_login_failures";

/**
 * `callRpc`, narrowed to the account-lockout RPC names
 * (login/actions.ts, forgot-password/actions.ts, guest-checkout.ts,
 * reset-password/actions.ts) — kept as a distinct name at those call sites
 * for readability; identical behaviour to `callRpc`.
 */
export async function callLockoutRpc<T = unknown>(
  supabase: SupabaseClient<Database>,
  fn: LockoutRpcName,
  args?: Record<string, string>
): Promise<T | null> {
  return callRpc<T>(supabase, fn, args);
}

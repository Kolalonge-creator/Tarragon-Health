import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

type LockoutRpcName =
  | "is_account_locked"
  | "is_account_locked_by_phone"
  | "record_failed_login"
  | "record_failed_login_by_phone"
  | "clear_login_failures";

/**
 * Thin wrapper around every account-lockout RPC call
 * (is_account_locked[_by_phone], record_failed_login[_by_phone],
 * clear_login_failures) across login/actions.ts, forgot-password/actions.ts,
 * guest-checkout.ts, and reset-password/actions.ts.
 *
 * Found in pre-merge review: every call site caught a THROWN exception
 * (network/fetch failure) but never inspected `result.error` — the shape
 * supabase-js actually resolves to on a PostgREST-level failure (permission
 * denied, wrong signature), which never throws. If the `anon`/`service_role`
 * EXECUTE grant on one of these functions is ever accidentally lost — this
 * exact codebase's own CLAUDE.md documents that exact class of regression
 * recurring five separate times for other functions ("Supabase anon-execute
 * gotcha") — every lockout check/record call would fail open platform-wide,
 * silently, with nothing distinguishing it from "no attacker ever showed up."
 * This does not change the fail-open behaviour itself (a lockout check must
 * never block a real login) — it only makes the failure discoverable.
 * `Sentry.captureMessage` is a safe no-op when SENTRY_DSN is unset (Sentry.
 * init() is never called in that case — see sentry.server.config.ts), so this
 * carries no cost in an environment without Sentry configured.
 *
 * `T` is supplied explicitly by the caller (matching the RPC's real return
 * type — boolean for the two `is_account_locked*` checks, undefined for the
 * other three) rather than derived from `Database["public"]["Functions"]`:
 * clear_login_failures takes no arguments at all (`Args: never` in the
 * generated types), which doesn't compose cleanly with a single generic
 * `args` parameter shared across every RPC name here — every real call site
 * in this codebase already calls it with no second argument, matched below
 * by `args` being optional.
 */
export async function callLockoutRpc<T = unknown>(
  supabase: SupabaseClient<Database>,
  fn: LockoutRpcName,
  args?: Record<string, string>
): Promise<T | null> {
  try {
    const result = args
      ? await supabase.rpc(fn as never, args as never)
      : await supabase.rpc(fn as never);
    if (result.error) {
      Sentry.captureMessage(`Lockout RPC "${fn}" returned an error`, {
        level: "error",
        extra: { fn, error: result.error },
      });
      return null;
    }
    return result.data as T;
  } catch (error) {
    Sentry.captureMessage(`Lockout RPC "${fn}" threw`, {
      level: "error",
      extra: { fn, error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

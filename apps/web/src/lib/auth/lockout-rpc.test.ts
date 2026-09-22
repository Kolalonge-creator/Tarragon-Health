/**
 * Regression: every lockout RPC call site used to catch a THROWN exception
 * but never inspect the resolved `{data, error}` shape supabase-js actually
 * returns on a PostgREST-level failure (permission denied, wrong signature —
 * which never throws). If the anon/service_role EXECUTE grant on one of
 * these functions were ever accidentally lost, every lockout check/record
 * would fail open platform-wide with nothing logged, indistinguishable from
 * "no attacker ever showed up." Proves callLockoutRpc reports both failure
 * shapes to Sentry (never throwing itself, and still returning null so
 * every caller's existing best-effort fail-open behaviour is unchanged).
 */

const captureMessage = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureMessage: (...args: unknown[]) => captureMessage(...args) }));

import { callLockoutRpc } from "./lockout-rpc";

beforeEach(() => {
  captureMessage.mockReset();
});

describe("callLockoutRpc", () => {
  it("returns the RPC's data on success, without touching Sentry", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc } as never;

    const result = await callLockoutRpc<boolean>(supabase, "is_account_locked", {
      p_email: "a@b.com",
    });

    expect(result).toBe(true);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("calls a zero-argument RPC (clear_login_failures) with no second argument", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { rpc } as never;

    await callLockoutRpc(supabase, "clear_login_failures");

    expect(rpc).toHaveBeenCalledWith("clear_login_failures");
  });

  it("reports a PostgREST-level error to Sentry and returns null (regression: this used to be silently ignored)", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "permission denied for function is_account_locked" },
    });
    const supabase = { rpc } as never;

    const result = await callLockoutRpc<boolean>(supabase, "is_account_locked", {
      p_email: "a@b.com",
    });

    expect(result).toBeNull();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, context] = captureMessage.mock.calls[0]!;
    expect(message).toContain("is_account_locked");
    expect((context as { extra: { error: unknown } }).extra.error).toEqual({
      message: "permission denied for function is_account_locked",
    });
  });

  it("reports a thrown exception (network failure) to Sentry and returns null", async () => {
    const rpc = jest.fn().mockRejectedValue(new Error("fetch failed"));
    const supabase = { rpc } as never;

    const result = await callLockoutRpc<boolean>(supabase, "is_account_locked", {
      p_email: "a@b.com",
    });

    expect(result).toBeNull();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("never throws itself, regardless of failure mode", async () => {
    const rpc = jest.fn().mockRejectedValue(new Error("boom"));
    const supabase = { rpc } as never;

    await expect(callLockoutRpc(supabase, "record_failed_login", { p_email: "a@b.com" })).resolves.toBeNull();
  });
});

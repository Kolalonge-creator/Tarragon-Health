/**
 * Regression coverage for the 2026-09-18 account-lockout feature
 * (20260918111442_account_lockout_after_repeated_failed_logins.sql). This is
 * the single highest-risk function touched in that change — it now branches
 * on lockout state before ever calling signInWithPassword/verifyOtp — so it
 * gets direct test coverage rather than relying on the DB proof script alone.
 *
 * What this proves, all against the real signInWithEmail/verifyPhoneOtp
 * server actions:
 *  - a locked account is refused (RATE_LIMIT_MESSAGE) WITHOUT ever calling
 *    signInWithPassword/verifyOtp — GoTrue is never touched;
 *  - record_failed_login is called via the SERVICE-ROLE client, never the
 *    ordinary anon-key client (the exact vector the pre-merge review found:
 *    granting anon EXECUTE on this let anyone lock an arbitrary account
 *    directly via PostgREST);
 *  - record_failed_login only fires for a genuine wrong-password result —
 *    never for "email not confirmed" or any other error class;
 *  - a successful sign-in clears the failure counter via the ordinary
 *    (non-service-role) client.
 */

jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/auth/record-login-device", () => ({ recordLoginDevice: jest.fn() }));
jest.mock("@/lib/auth/redirect-after-login", () => ({
  resolveLoginDestination: jest.fn().mockResolvedValue("/patient"),
}));
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true, retryAfterSeconds: 0 }),
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a moment, then try again.",
}));

const anonRpc = jest.fn();
const serviceRoleRpc = jest.fn();
const signInWithPassword = jest.fn();
const verifyOtp = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: anonRpc,
    auth: { signInWithPassword, verifyOtp },
  }),
}));

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: serviceRoleRpc })),
}));

import { signInWithEmail, verifyPhoneOtp } from "./actions";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

function loginFormData(email: string, password: string) {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

function otpFormData(phone: string, token: string) {
  const fd = new FormData();
  fd.set("phone", phone);
  fd.set("token", token);
  return fd;
}

beforeEach(() => {
  anonRpc.mockReset();
  serviceRoleRpc.mockReset().mockResolvedValue({ data: null, error: null });
  signInWithPassword.mockReset();
  verifyOtp.mockReset();
});

describe("signInWithEmail — account lockout", () => {
  it("refuses a locked account before ever calling signInWithPassword", async () => {
    anonRpc.mockResolvedValue({ data: true, error: null }); // is_account_locked -> true

    const result = await signInWithEmail(
      undefined,
      loginFormData("locked@example.com", "correcthorsebattery")
    );

    expect(result?.error).toBe(RATE_LIMIT_MESSAGE);
    expect(anonRpc).toHaveBeenCalledWith("is_account_locked", { p_email: "locked@example.com" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("calls record_failed_login via the SERVICE-ROLE client, never the anon-key client, on a genuine credentials failure", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null }); // is_account_locked -> false
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });

    await signInWithEmail(undefined, loginFormData("wrong@example.com", "wrongpassword"));

    expect(serviceRoleRpc).toHaveBeenCalledWith("record_failed_login", {
      p_email: "wrong@example.com",
    });
    // The anon-key client's own rpc() must only have been used for the
    // lockout CHECK, never for recording a failure — that write is the exact
    // vector the pre-merge review found (anon EXECUTE on record_failed_login
    // let anyone lock an arbitrary account directly via PostgREST).
    const anonRpcCalls = anonRpc.mock.calls.map((call) => call[0]);
    expect(anonRpcCalls).not.toContain("record_failed_login");
  });

  it("does NOT record a failure for 'email not confirmed' — that is not a wrong password", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Email not confirmed" },
    });

    await signInWithEmail(undefined, loginFormData("unconfirmed@example.com", "correctpassword"));

    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });

  it("does NOT record a failure for GoTrue's own rate limiting", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "For security purposes, you can only request this after 47 seconds" },
    });

    await signInWithEmail(undefined, loginFormData("ratelimited@example.com", "correctpassword"));

    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });

  it("clears failures via the ordinary client on a successful sign-in", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await signInWithEmail(undefined, loginFormData("real@example.com", "correctpassword"));

    expect(anonRpc).toHaveBeenCalledWith("clear_login_failures");
    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });
});

describe("verifyPhoneOtp — account lockout", () => {
  it("refuses a locked account before ever calling verifyOtp", async () => {
    anonRpc.mockResolvedValue({ data: true, error: null }); // is_account_locked_by_phone -> true

    const result = await verifyPhoneOtp(undefined, otpFormData("+2348012345678", "123456"));

    expect(result?.error).toBe(RATE_LIMIT_MESSAGE);
    expect(anonRpc).toHaveBeenCalledWith("is_account_locked_by_phone", {
      p_phone: "+2348012345678",
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("calls record_failed_login_by_phone via the SERVICE-ROLE client on a genuine wrong-code failure", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Invalid otp" } });

    await verifyPhoneOtp(undefined, otpFormData("+2348012345678", "000000"));

    expect(serviceRoleRpc).toHaveBeenCalledWith("record_failed_login_by_phone", {
      p_phone: "+2348012345678",
    });
  });

  it("does NOT record a failure for a rate-limit error", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "For security purposes, you can only request this after 47 seconds" },
    });

    await verifyPhoneOtp(undefined, otpFormData("+2348012345678", "123456"));

    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });

  it("clears failures via the ordinary client on a successful verify", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await verifyPhoneOtp(undefined, otpFormData("+2348012345678", "123456"));

    expect(anonRpc).toHaveBeenCalledWith("clear_login_failures");
    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });
});

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
 *  - signInWithEmail's password path no longer calls record_failed_login/
 *    clear_login_failures itself, on ANY outcome — regression coverage for a
 *    real bug found and fixed 2026-09-22 (see
 *    20260922201110_password_verification_hook_gotrue_level_lockout.sql):
 *    once GoTrue's own Password Verification Attempt Auth Hook
 *    (public.hook_password_verification_attempt) started recording/clearing
 *    the SAME account_lockouts row as part of signInWithPassword itself,
 *    this action ALSO calling those RPCs double-counted every web attempt,
 *    silently halving the documented/tested "5 failed attempts" lockout
 *    threshold to 3 for web sign-ins specifically. The is_account_locked
 *    pre-check is unaffected (read-only, still called for fast UX feedback);
 *  - the phone-OTP path below is a DIFFERENT story: there is no GoTrue Auth
 *    Hook for OTP verification, so verifyPhoneOtp is still the ONLY
 *    enforcement point for that path and must keep calling
 *    record_failed_login_by_phone/clear_login_failures directly — do not
 *    "simplify" that block to match the password path above.
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
const signInWithOtp = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: anonRpc,
    auth: { signInWithPassword, verifyOtp, signInWithOtp },
  }),
}));

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: serviceRoleRpc })),
}));

import { requestPhoneOtp, signInWithEmail, verifyPhoneOtp } from "./actions";
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

function otpRequestFormData(countryCode: string, phone: string) {
  const fd = new FormData();
  fd.set("countryCode", countryCode);
  fd.set("phone", phone);
  return fd;
}

beforeEach(() => {
  anonRpc.mockReset();
  serviceRoleRpc.mockReset().mockResolvedValue({ data: null, error: null });
  signInWithPassword.mockReset();
  verifyOtp.mockReset();
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
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

  it("does NOT call record_failed_login itself on a genuine credentials failure — GoTrue's own Auth Hook records it now", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null }); // is_account_locked -> false
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });

    await signInWithEmail(undefined, loginFormData("wrong@example.com", "wrongpassword"));

    // Regression: this action calling record_failed_login here (on top of
    // the GoTrue hook doing the same recording as part of
    // signInWithPassword itself) is exactly the double-counting bug fixed
    // 2026-09-22 — see this file's header comment.
    expect(serviceRoleRpc).not.toHaveBeenCalled();
    const anonRpcCalls = anonRpc.mock.calls.map((call) => call[0]);
    expect(anonRpcCalls).not.toContain("record_failed_login");
  });

  it("does NOT call clear_login_failures itself on a successful sign-in — GoTrue's own Auth Hook clears it now", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await signInWithEmail(undefined, loginFormData("real@example.com", "correctpassword"));

    const anonRpcCalls = anonRpc.mock.calls.map((call) => call[0]);
    expect(anonRpcCalls).not.toContain("clear_login_failures");
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

  // Griefing-vector regression: requestPhoneOtp needs only a phone number
  // (not a secret) to trigger a real OTP send, so an attacker who doesn't
  // own the phone is GUARANTEED to fail every guess here with zero effort —
  // if that counted toward the shared lockout, anyone who merely knows a
  // victim's phone number could lock them out of login indefinitely. See
  // guest-checkout.ts's verifyGuestCheckoutOtp for the fuller writeup of the
  // same fix. Never call record_failed_login_by_phone from this verify
  // path, for any error shape.
  it.each([
    { message: "Invalid otp" },
    { message: "Token has expired or is invalid" },
    { message: "For security purposes, you can only request this after 47 seconds" },
    { message: "TypeError: fetch failed" },
  ])("never calls record_failed_login_by_phone for a %j verifyOtp failure", async (errorShape) => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({ data: { user: null }, error: errorShape });

    await verifyPhoneOtp(undefined, otpFormData("+2348012345678", "000000"));

    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });

  it("an anonymous actor with only a victim's phone number cannot lock the victim out via repeated wrong guesses", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null }); // never locked
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Invalid otp" } });

    for (let i = 0; i < 5; i++) {
      await verifyPhoneOtp(undefined, otpFormData("+2348012345678", "000000"));
    }

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

describe("requestPhoneOtp — account lockout", () => {
  it("refuses to send an OTP to a locked account", async () => {
    anonRpc.mockResolvedValue({ data: true, error: null });

    const result = await requestPhoneOtp(undefined, otpRequestFormData("+234", "8012345678"));

    expect(result?.error).toBe(RATE_LIMIT_MESSAGE);
    expect(anonRpc).toHaveBeenCalledWith("is_account_locked_by_phone", {
      p_phone: "+2348012345678",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends the OTP when the account is not locked", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });

    const result = await requestPhoneOtp(undefined, otpRequestFormData("+234", "8012345678"));

    expect(result?.step).toBe("verify");
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: "+2348012345678" });
  });
});

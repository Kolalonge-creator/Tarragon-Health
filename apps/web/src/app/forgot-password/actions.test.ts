/**
 * Two related regressions around verifyPhoneReset/requestPhoneReset (the
 * phone-OTP half of forgot-password):
 *
 * 1. Bypass (fixed): verifyPhoneReset never checked lockout state at all —
 *    an account locked via repeated failed sign-in attempts could still be
 *    reached (and its password CHANGED) by brute-forcing an OTP through the
 *    password-reset flow. Both functions now READ is_account_locked_by_phone
 *    before proceeding.
 *
 * 2. Griefing vector (found and reverted before merge, NOT built): an
 *    earlier version of this fix also called record_failed_login_by_phone
 *    on a wrong OTP guess here. That is wrong for this entry point
 *    specifically — requestPhoneReset needs only a phone number (not a
 *    secret) to trigger a real OTP send, so an attacker who doesn't own the
 *    phone is GUARANTEED to fail every guess they submit here, with zero
 *    effort or risk. If that counted toward the shared lockout, anyone who
 *    merely knows a victim's phone number could lock the victim out of
 *    login indefinitely, repeatable forever — see guest-checkout.ts's
 *    verifyGuestCheckoutOtp for the fuller writeup of the identical fix
 *    applied there. verifyPhoneReset deliberately never calls
 *    record_failed_login_by_phone at all; this file proves that stays true
 *    even across repeated wrong guesses.
 */

jest.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true, retryAfterSeconds: 0 }),
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a moment, then try again.",
}));

const anonRpc = jest.fn();
const verifyOtp = jest.fn();
const signInWithOtp = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: anonRpc,
    auth: { verifyOtp, resetPasswordForEmail: jest.fn(), signInWithOtp },
  }),
}));

import { requestPhoneReset, verifyPhoneReset } from "./actions";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

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
  verifyOtp.mockReset();
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
});

describe("verifyPhoneReset — account lockout (bypass regression)", () => {
  it("refuses a locked account before ever calling verifyOtp", async () => {
    anonRpc.mockResolvedValue({ data: true, error: null });

    const result = await verifyPhoneReset(undefined, otpFormData("+2348012345678", "123456"));

    expect(result?.error).toBe(RATE_LIMIT_MESSAGE);
    expect(anonRpc).toHaveBeenCalledWith("is_account_locked_by_phone", {
      p_phone: "+2348012345678",
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("clears failures via the ordinary client on a successful verify", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await verifyPhoneReset(undefined, otpFormData("+2348012345678", "123456"));

    expect(anonRpc).toHaveBeenCalledWith("clear_login_failures");
  });
});

describe("verifyPhoneReset — griefing-vector regression (must NEVER record a failure)", () => {
  it.each([
    { message: "Invalid otp" },
    { message: "Token has expired or is invalid" },
    { message: "For security purposes, you can only request this after 47 seconds" },
    { message: "TypeError: fetch failed" },
  ])("never calls record_failed_login_by_phone for a %j verifyOtp failure", async (errorShape) => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({ data: { user: null }, error: errorShape });

    await verifyPhoneReset(undefined, otpFormData("+2348012345678", "000000"));

    const anonRpcCalls = anonRpc.mock.calls.map((call) => call[0]);
    expect(anonRpcCalls).not.toContain("record_failed_login_by_phone");
  });

  it("an anonymous actor with only a victim's phone number cannot lock the victim out via repeated wrong guesses", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null }); // never locked
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Invalid otp" } });

    for (let i = 0; i < 5; i++) {
      await verifyPhoneReset(undefined, otpFormData("+2348012345678", "000000"));
    }

    const anonRpcCalls = anonRpc.mock.calls.map((call) => call[0]);
    expect(anonRpcCalls).not.toContain("record_failed_login_by_phone");
  });
});

describe("requestPhoneReset — account lockout", () => {
  it("refuses to send a reset OTP to a locked account", async () => {
    anonRpc.mockResolvedValue({ data: true, error: null });

    const result = await requestPhoneReset(undefined, otpRequestFormData("+234", "8012345678"));

    expect(result?.error).toBe(RATE_LIMIT_MESSAGE);
    expect(anonRpc).toHaveBeenCalledWith("is_account_locked_by_phone", {
      p_phone: "+2348012345678",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends the OTP when the account is not locked", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });

    const result = await requestPhoneReset(undefined, otpRequestFormData("+234", "8012345678"));

    expect(result?.step).toBe("verify");
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: "+2348012345678" });
  });
});

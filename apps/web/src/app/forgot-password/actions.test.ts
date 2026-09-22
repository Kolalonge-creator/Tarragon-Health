/**
 * Regression coverage for a bypass of the 2026-09-18 account-lockout feature
 * (20260918111442_account_lockout_after_repeated_failed_logins.sql), found
 * during pre-merge review: verifyPhoneReset (the phone-OTP half of
 * forgot-password) never checked lockout state at all, and never recorded a
 * failure either — an account locked via repeated failed sign-in attempts
 * could still be reached (and its password CHANGED) by brute-forcing an OTP
 * through the password-reset flow, a complete bypass of the lockout rather
 * than a missed method. Proves, against the real verifyPhoneReset:
 *  - a locked account is refused BEFORE verifyOtp is ever called;
 *  - record_failed_login_by_phone fires via the SERVICE-ROLE client on a
 *    genuine wrong-code result, never the anon-key client;
 *  - a successful verify clears the failure counter.
 */

jest.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true, retryAfterSeconds: 0 }),
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a moment, then try again.",
}));

const anonRpc = jest.fn();
const serviceRoleRpc = jest.fn();
const verifyOtp = jest.fn();
const signInWithOtp = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: anonRpc,
    auth: { verifyOtp, resetPasswordForEmail: jest.fn(), signInWithOtp },
  }),
}));

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: serviceRoleRpc })),
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
  serviceRoleRpc.mockReset().mockResolvedValue({ data: null, error: null });
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

  it("records a failure via the SERVICE-ROLE client on a genuine wrong-code result", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Invalid otp" } });

    await verifyPhoneReset(undefined, otpFormData("+2348012345678", "000000"));

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

    await verifyPhoneReset(undefined, otpFormData("+2348012345678", "123456"));

    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });

  it("clears failures via the ordinary client on a successful verify", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await verifyPhoneReset(undefined, otpFormData("+2348012345678", "123456"));

    expect(anonRpc).toHaveBeenCalledWith("clear_login_failures");
    expect(serviceRoleRpc).not.toHaveBeenCalled();
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

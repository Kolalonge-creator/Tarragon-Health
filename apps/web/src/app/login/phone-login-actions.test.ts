/**
 * Phone sign-in and recovery (S03, functions 1.3 and 1.6): login/actions.ts and forgot-password/actions.ts.
 *
 * Pinned here:
 *  - phone + password signs in; a number that was never confirmed gets a fresh code and the verify step, not a session;
 *  - asking for a code NEVER creates an account (shouldCreateUser:false) and an unknown number gets the same
 *    "code sent" answer as a registered one, so the screen cannot be used to learn who is registered;
 *  - a wrong password and an unknown number read identically;
 *  - limits are keyed on the phone, and a refusal touches nothing.
 */

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map()),
  cookies: jest.fn().mockResolvedValue({ get: () => undefined }),
}));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

const rateLimitMock = jest.fn().mockResolvedValue({ success: true });
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: (...args: unknown[]) => rateLimitMock(...args),
  RATE_LIMIT_MESSAGE: "Too many attempts.",
}));

const signInWithPasswordMock = jest.fn();
const signInWithOtpMock = jest.fn();
const resendMock = jest.fn();
const verifyOtpMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signInWithOtp: signInWithOtpMock,
      resend: resendMock,
      verifyOtp: verifyOtpMock,
    },
  }),
}));

const redirectAfterLoginMock = jest.fn().mockImplementation(() => {
  throw new Error("NEXT_REDIRECT:signed-in");
});
jest.mock("@/lib/auth/redirect-after-login", () => ({
  redirectAfterLogin: (...args: unknown[]) => redirectAfterLoginMock(...args),
}));

import { requestPhoneOtp, signInWithPhonePassword } from "./actions";
import { requestPhoneReset } from "../forgot-password/actions";

const NG = "+2348031234567";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const passwordForm = (overrides: Record<string, string> = {}) =>
  form({ countryCode: "+234", phone: "0803 123 4567", password: "correct-horse-battery", redirectTo: "", ...overrides });
const codeForm = () => form({ countryCode: "+234", phone: "8031234567" });

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  signInWithOtpMock.mockReset().mockResolvedValue({ error: null });
  resendMock.mockReset().mockResolvedValue({ error: null });
  verifyOtpMock.mockReset();
  redirectAfterLoginMock.mockClear();
  rateLimitMock.mockReset().mockResolvedValue({ success: true });
});

describe("signInWithPhonePassword", () => {
  it("normalises the number, signs in with the phone identity and redirects", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(signInWithPhonePassword(undefined, passwordForm())).rejects.toThrow("NEXT_REDIRECT:signed-in");
    expect(signInWithPasswordMock).toHaveBeenCalledWith({ phone: NG, password: "correct-horse-battery" });
  });

  it("an unconfirmed number gets a fresh code and the verify step, never a session", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: "Phone not confirmed" } });
    const result = await signInWithPhonePassword(undefined, passwordForm());
    expect(result).toMatchObject({ step: "verify", phone: NG });
    expect(result?.notice).toBeTruthy();
    expect(resendMock).toHaveBeenCalledWith({ type: "sms", phone: NG });
    expect(redirectAfterLoginMock).not.toHaveBeenCalled();
  });

  it("does not announce a code that could not be sent: a failed resend is an error, not the verify step", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: "Phone not confirmed" } });
    resendMock.mockResolvedValue({ error: { message: "Error sending sms" } });
    const result = await signInWithPhonePassword(undefined, passwordForm());
    expect(result?.error).toBeTruthy();
    expect(result?.step).toBeUndefined();
  });

  it("a rate-limited resend still shows the verify step (a code from the last minute is on its way)", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: "Phone not confirmed" } });
    resendMock.mockResolvedValue({ error: { message: "For security purposes, you can only request this after 30 seconds." } });
    const result = await signInWithPhonePassword(undefined, passwordForm());
    expect(result?.step).toBe("verify");
  });

  it("does not send another code when the per-phone resend limit is hit, but still shows the verify step", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: "Phone not confirmed" } });
    rateLimitMock.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
    const result = await signInWithPhonePassword(undefined, passwordForm());
    expect(result?.step).toBe("verify");
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("a wrong password and an unknown number read identically (no enumeration)", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid login credentials" } });
    const wrongPassword = await signInWithPhonePassword(undefined, passwordForm());
    signInWithPasswordMock.mockResolvedValueOnce({ data: { user: null }, error: { message: "User not found" } });
    const unknown = await signInWithPhonePassword(undefined, passwordForm());
    expect(wrongPassword).toEqual(unknown);
    expect(wrongPassword?.error).toBeTruthy();
    expect(wrongPassword?.step).toBeUndefined();
  });

  it("is rate limited per phone and refusal never reaches Supabase", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    const result = await signInWithPhonePassword(undefined, passwordForm());
    expect(result?.error).toBeTruthy();
    expect(rateLimitMock).toHaveBeenCalledWith("login-phone-password", NG, expect.anything(), expect.anything());
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("rejects an impossible number before any network call", async () => {
    const result = await signInWithPhonePassword(undefined, passwordForm({ phone: "0603123456" }));
    expect(result?.field).toBe("phone");
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });
});

describe.each([
  ["requestPhoneOtp (code sign-in)", requestPhoneOtp],
  ["requestPhoneReset (recovery)", requestPhoneReset],
])("%s", (_name, action) => {
  it("never creates an account: shouldCreateUser is false", async () => {
    await action(undefined, codeForm());
    expect(signInWithOtpMock).toHaveBeenCalledWith({ phone: NG, options: { shouldCreateUser: false } });
  });

  it("an unknown number gets the same 'code sent' answer as a registered one", async () => {
    const registered = await action(undefined, codeForm());
    signInWithOtpMock.mockResolvedValue({ error: { code: "otp_disabled", message: "Signups not allowed for otp" } });
    const unknown = await action(undefined, codeForm());
    expect(unknown).toEqual(registered);
    expect(unknown).toMatchObject({ step: "verify", phone: NG });
  });

  it("a registered number asked twice inside GoTrue's resend gap looks the same as an unknown one (no rate-limit oracle)", async () => {
    signInWithOtpMock.mockResolvedValue({
      error: { message: "For security purposes, you can only request this after 47 seconds." },
    });
    const limited = await action(undefined, codeForm());
    signInWithOtpMock.mockResolvedValue({ error: { code: "otp_disabled", message: "Signups not allowed for otp" } });
    const unknown = await action(undefined, codeForm());
    expect(limited).toEqual(unknown);
    expect(limited).toMatchObject({ step: "verify", phone: NG });
  });

  it("a genuine delivery failure is still reported", async () => {
    signInWithOtpMock.mockResolvedValue({ error: { message: "Error sending sms" } });
    const result = await action(undefined, codeForm());
    expect(result?.error).toBeTruthy();
    expect(result?.step).toBeUndefined();
  });
});

/**
 * Security audit 2026-11-05, H-7: every sign-in the provider refuses is recorded (hashed identifier only) so the
 * failed_sign_in_spike operations alert can see password guessing. Pinned here: each failure path records exactly once with
 * its method; a success, a validation error, a rate-limited request and the "number not confirmed" answer (the password was
 * right) record nothing.
 */

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map()),
  cookies: jest.fn().mockResolvedValue({ get: () => undefined }),
}));

const rateLimitMock = jest.fn();
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: (...args: unknown[]) => rateLimitMock(...args),
  RATE_LIMIT_MESSAGE: "Too many attempts.",
}));

const signInWithPasswordMock = jest.fn();
const verifyOtpMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      verifyOtp: verifyOtpMock,
      resend: jest.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

jest.mock("@/lib/auth/redirect-after-login", () => ({
  redirectAfterLogin: jest.fn().mockImplementation(() => {
    throw new Error("NEXT_REDIRECT:signed-in");
  }),
}));

const recordFailedSignInMock = jest.fn().mockResolvedValue(undefined);
jest.mock("@tarragon/auth/record-failed-sign-in", () => ({
  recordFailedSignIn: (...args: unknown[]) => recordFailedSignInMock(...args),
}));

import { signInWithEmail, signInWithPhonePassword, verifyPhoneOtp } from "./actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const emailForm = () => form({ email: "ada@example.com", password: "correct-horse-battery", redirectTo: "" });
const phonePasswordForm = () => form({ countryCode: "+234", phone: "0803 123 4567", password: "correct-horse-battery", redirectTo: "" });
const codeForm = () => form({ phone: "+2348031234567", token: "123456", redirectTo: "" });
const refused = { data: { user: null }, error: { message: "Invalid login credentials" } };

beforeEach(() => {
  recordFailedSignInMock.mockClear();
  signInWithPasswordMock.mockReset();
  verifyOtpMock.mockReset();
  rateLimitMock.mockReset().mockResolvedValue({ success: true });
});

describe("failed sign-ins are recorded", () => {
  it("email and password refused", async () => {
    signInWithPasswordMock.mockResolvedValue(refused);
    await signInWithEmail(undefined, emailForm());
    expect(recordFailedSignInMock).toHaveBeenCalledTimes(1);
    expect(recordFailedSignInMock).toHaveBeenCalledWith("ada@example.com", "email_password");
  });

  it("phone and password refused", async () => {
    signInWithPasswordMock.mockResolvedValue(refused);
    await signInWithPhonePassword(undefined, phonePasswordForm());
    expect(recordFailedSignInMock).toHaveBeenCalledWith("+2348031234567", "phone_password");
  });

  it("a wrong code", async () => {
    verifyOtpMock.mockResolvedValue({ data: { user: null }, error: { message: "Token has expired or is invalid" } });
    await verifyPhoneOtp(undefined, codeForm());
    expect(recordFailedSignInMock).toHaveBeenCalledWith("+2348031234567", "phone_code");
  });
});

describe("nothing is recorded when the provider did not refuse a guess", () => {
  it("a successful sign-in", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(signInWithEmail(undefined, emailForm())).rejects.toThrow("NEXT_REDIRECT:signed-in");
    expect(recordFailedSignInMock).not.toHaveBeenCalled();
  });

  it("a rate-limited request never reaches the provider", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    await signInWithEmail(undefined, emailForm());
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(recordFailedSignInMock).not.toHaveBeenCalled();
  });

  it("a malformed form", async () => {
    await signInWithEmail(undefined, form({ email: "not-an-email", password: "" }));
    expect(recordFailedSignInMock).not.toHaveBeenCalled();
  });

  it("a number that is not confirmed yet (the password was right)", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: "Phone not confirmed" } });
    await signInWithPhonePassword(undefined, phonePasswordForm());
    expect(recordFailedSignInMock).not.toHaveBeenCalled();
  });
});

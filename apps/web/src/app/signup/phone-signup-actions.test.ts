/**
 * Phone-first sign-up and verification (S03, functions 1.1 and 1.2): the server actions in signup/actions.ts.
 *
 * What matters here and is pinned below:
 *  - sign-up creates the account on the PHONE identity and moves to the code step; it never signs anyone in or
 *    redirects before the code is verified;
 *  - a verified code is the only thing that reaches redirectAfterLogin;
 *  - the phone is normalised (0803..., +2340803...) before it reaches Supabase;
 *  - a breached password is refused before any account is created;
 *  - the rate limit is keyed on the phone, and a refusal creates nothing and sends nothing;
 *  - no error string carries the phone number or the code.
 */

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map([["origin", "https://app.tarragonhealth.ng"]])),
  cookies: jest.fn().mockResolvedValue({ get: () => undefined }),
}));

const rateLimitMock = jest.fn().mockResolvedValue({ success: true });
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: (...args: unknown[]) => rateLimitMock(...args),
  RATE_LIMIT_MESSAGE: "Too many attempts.",
}));

const signUpMock = jest.fn();
const verifyOtpMock = jest.fn();
const resendMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { signUp: signUpMock, verifyOtp: verifyOtpMock, resend: resendMock },
  }),
}));

const redirectAfterLoginMock = jest.fn().mockImplementation((_s, _id, dest) => {
  throw new Error(`NEXT_REDIRECT:${dest ?? "unset"}`);
});
jest.mock("@/lib/auth/redirect-after-login", () => ({
  redirectAfterLogin: (...args: unknown[]) => redirectAfterLoginMock(...args),
}));

const backfillMock = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/auth/backfill-signup-metadata", () => ({
  backfillSignupMetadata: (...args: unknown[]) => backfillMock(...args),
}));

const passwordCheckMock = jest.fn();
jest.mock("@tarragon/auth/password-check", () => ({
  checkPasswordAcceptable: (...args: unknown[]) => passwordCheckMock(...args),
}));

import { resendSignupCode, signUpWithPhone, verifySignupPhone } from "./actions";

const NG = "+2348031234567";

function signupForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("firstName", "Amaka");
  fd.set("lastName", "Okoro");
  fd.set("countryCode", "+234");
  fd.set("phone", "0803 123 4567");
  fd.set("state", "");
  fd.set("password", "a-strong-password-123");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  signUpMock.mockReset().mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
  verifyOtpMock.mockReset();
  resendMock.mockReset().mockResolvedValue({ error: null });
  redirectAfterLoginMock.mockClear();
  backfillMock.mockClear();
  rateLimitMock.mockReset().mockResolvedValue({ success: true });
  passwordCheckMock.mockReset().mockResolvedValue({ ok: true, breach: "clean" });
});

describe("signUpWithPhone", () => {
  it("creates the account on the phone identity with the normalised number and moves to the code step", async () => {
    const result = await signUpWithPhone(undefined, signupForm());
    expect(result).toMatchObject({ step: "verify", phone: NG });
    const args = signUpMock.mock.calls[0]![0] as { phone: string; email?: string; options: { data: Record<string, unknown> } };
    expect(args.phone).toBe(NG);
    expect(args.email).toBeUndefined();
    expect(args.options.data.full_name).toBe("Amaka Okoro");
    // Unverified: nothing signs in, nothing redirects, nothing backfills yet.
    expect(redirectAfterLoginMock).not.toHaveBeenCalled();
    expect(backfillMock).not.toHaveBeenCalled();
  });

  it("an already-registered number gets the same code step as a new one (no enumeration)", async () => {
    signUpMock.mockResolvedValue({ data: {}, error: { code: "user_already_exists", message: "User already registered" } });
    const existing = await signUpWithPhone(undefined, signupForm());
    signUpMock.mockResolvedValue({ data: { user: { id: "u2" }, session: null }, error: null });
    const fresh = await signUpWithPhone(undefined, signupForm());
    expect(existing).toEqual(fresh);
    expect(existing).toMatchObject({ step: "verify", phone: NG });
  });

  it("refuses a breached password before any account is created", async () => {
    passwordCheckMock.mockResolvedValue({ ok: false, reason: "breached", message: "x" });
    const result = await signUpWithPhone(undefined, signupForm());
    expect(result?.field).toBe("password");
    expect(result?.error).toBeTruthy();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("keys the rate limit on the phone and creates nothing when refused", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    const result = await signUpWithPhone(undefined, signupForm());
    expect(result?.error).toBeTruthy();
    expect(rateLimitMock).toHaveBeenCalledWith("signup-phone", NG, expect.anything(), expect.anything());
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("rejects a number that cannot be a Nigerian mobile with a phone-field error and no account", async () => {
    const result = await signUpWithPhone(undefined, signupForm({ phone: "0603123456" }));
    expect(result?.field).toBe("phone");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("does not echo the phone number or password in a provider error", async () => {
    signUpMock.mockResolvedValue({ data: {}, error: { message: `failed for ${NG} with a-strong-password-123` } });
    const result = await signUpWithPhone(undefined, signupForm());
    expect(JSON.stringify(result)).not.toContain("8031234567");
    expect(JSON.stringify(result)).not.toContain("a-strong-password-123");
  });

  it("answers a rate-limit refusal in English", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    const result = await signUpWithPhone(undefined, signupForm());
    expect(result?.error).toMatch(/too many attempts/i);
  });
});

describe("verifySignupPhone", () => {
  const verifyForm = (token = "123456") => {
    const fd = new FormData();
    fd.set("phone", NG);
    fd.set("token", token);
    fd.set("redirectTo", "/patient");
    return fd;
  };

  it("a correct code backfills the profile and only then signs in (redirects)", async () => {
    verifyOtpMock.mockResolvedValue({ data: { user: { id: "u1", user_metadata: {} } }, error: null });
    await expect(verifySignupPhone(undefined, verifyForm())).rejects.toThrow("NEXT_REDIRECT");
    expect(verifyOtpMock).toHaveBeenCalledWith({ phone: NG, token: "123456", type: "sms" });
    expect(backfillMock).toHaveBeenCalledTimes(1);
  });

  it("a wrong code stays on the verify step with a code-field error and signs nobody in", async () => {
    verifyOtpMock.mockResolvedValue({ data: { user: null }, error: { message: "Token has expired or is invalid" } });
    const result = await verifySignupPhone(undefined, verifyForm());
    expect(result).toMatchObject({ step: "verify", phone: NG, field: "token" });
    expect(redirectAfterLoginMock).not.toHaveBeenCalled();
  });

  it("a malformed code never reaches Supabase", async () => {
    const result = await verifySignupPhone(undefined, verifyForm("12"));
    expect(result?.step).toBe("verify");
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("the verify step is rate limited on the phone (a six-digit code is only a million guesses)", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    const result = await verifySignupPhone(undefined, verifyForm());
    expect(result?.error).toBeTruthy();
    expect(rateLimitMock).toHaveBeenCalledWith("signup-phone-verify", NG, expect.anything(), expect.anything());
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("never leaves the code in the returned state or error text", async () => {
    // A code that does not occur inside the test phone number, so the assertion cannot pass or fail by coincidence.
    verifyOtpMock.mockResolvedValue({ data: { user: null }, error: { message: "bad code 987654" } });
    const result = await verifySignupPhone(undefined, verifyForm("987654"));
    expect(JSON.stringify(result)).not.toContain("987654");
  });
});

describe("resendSignupCode", () => {
  const resendForm = (phone = NG) => {
    const fd = new FormData();
    fd.set("phone", phone);
    return fd;
  };

  it("asks GoTrue for a new sms code and stamps sentAt so the countdown restarts", async () => {
    const result = await resendSignupCode(undefined, resendForm());
    expect(resendMock).toHaveBeenCalledWith({ type: "sms", phone: NG });
    expect(result?.sentAt).toEqual(expect.any(Number));
  });

  it("refuses a non-E.164 phone and is rate limited per phone", async () => {
    expect((await resendSignupCode(undefined, resendForm("0803")))?.error).toBeTruthy();
    expect(resendMock).not.toHaveBeenCalled();
    rateLimitMock.mockResolvedValue({ success: false });
    expect((await resendSignupCode(undefined, resendForm()))?.error).toBeTruthy();
    expect(resendMock).not.toHaveBeenCalled();
  });
});

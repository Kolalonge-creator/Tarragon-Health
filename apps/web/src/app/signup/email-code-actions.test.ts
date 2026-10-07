/**
 * The optional email code (S41, spec 1.4): verifySignupEmail and resendSignupEmail in signup/actions.ts.
 * Pinned: a verified code is the only thing that reaches redirectAfterLogin; a malformed code never reaches the provider;
 * the limit is keyed on the email and a refusal sends nothing; no message carries the address or the code.
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

const verifyOtpMock = jest.fn();
const resendMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { verifyOtp: verifyOtpMock, resend: resendMock },
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

import { resendSignupEmail, verifySignupEmail } from "./actions";

const EMAIL = "amaka@example.com";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  verifyOtpMock.mockReset();
  resendMock.mockReset().mockResolvedValue({ error: null });
  redirectAfterLoginMock.mockClear();
  backfillMock.mockClear();
  rateLimitMock.mockReset().mockResolvedValue({ success: true });
});

describe("verifySignupEmail", () => {
  it("verifies a six-digit code as a signup token, then signs in and redirects", async () => {
    verifyOtpMock.mockResolvedValue({ data: { user: { id: "u1", user_metadata: {} } }, error: null });
    await expect(verifySignupEmail(undefined, form({ email: EMAIL, token: "123456" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(verifyOtpMock).toHaveBeenCalledWith({ email: EMAIL, token: "123456", type: "signup" });
    expect(backfillMock).toHaveBeenCalledTimes(1);
  });

  it("never reaches the provider with a malformed code", async () => {
    for (const token of ["12345", "1234567", "abcdef", ""]) {
      const result = await verifySignupEmail(undefined, form({ email: EMAIL, token }));
      expect(result).toMatchObject({ field: "token", success: true });
    }
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(redirectAfterLoginMock).not.toHaveBeenCalled();
  });

  it("a wrong code shows a mapped message, never the provider's text, the address or the code", async () => {
    verifyOtpMock.mockResolvedValue({ data: { user: null }, error: { message: "Token has expired or is invalid for amaka@example.com 654321" } });
    const result = await verifySignupEmail(undefined, form({ email: EMAIL, token: "654321" }));
    expect(result?.error).toBeTruthy();
    expect(result?.error).not.toContain("654321");
    expect(result?.error).not.toContain("amaka");
    expect(redirectAfterLoginMock).not.toHaveBeenCalled();
  });

  it("is limited per email, and a refusal never calls the provider", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    const result = await verifySignupEmail(undefined, form({ email: EMAIL, token: "123456" }));
    expect(rateLimitMock).toHaveBeenCalledWith("signup-email-verify", EMAIL, expect.anything(), expect.anything());
    expect(result?.error).toBeTruthy();
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});

describe("resendSignupEmail", () => {
  it("asks for a new signup email and stamps sentAt", async () => {
    const result = await resendSignupEmail(undefined, form({ email: EMAIL }));
    expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: EMAIL });
    expect(result?.sentAt).toBeGreaterThan(0);
    expect(result?.error).toBeUndefined();
  });

  it("refuses an invalid address without calling the provider", async () => {
    const result = await resendSignupEmail(undefined, form({ email: "not-an-email" }));
    expect(result?.error).toBeTruthy();
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("is limited per email", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    const result = await resendSignupEmail(undefined, form({ email: EMAIL }));
    expect(result?.error).toBeTruthy();
    expect(resendMock).not.toHaveBeenCalled();
  });
});

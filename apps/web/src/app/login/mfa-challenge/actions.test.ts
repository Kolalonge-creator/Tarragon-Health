/**
 * Regression: verifyLoginMfaChallenge redirected onward after a successful
 * TOTP verification without stamping the idle-timeout activity cookie. The
 * cookie was last stamped at the password/OTP step, BEFORE this challenge,
 * and /login/mfa-challenge itself is idle-timeout-exempt (no stamp happens
 * there either) — so an MFA-enrolled patient whose challenge took longer
 * than IDLE_TIMEOUT_MINUTES (finding their authenticator app, typing the
 * code) got bounced straight to /login?reason=idle immediately after
 * entering the CORRECT code. Proves stampActivityCookie now runs on both
 * success paths: a real TOTP verify, and the "nothing enrolled after all"
 * fallback.
 */

// Real next/navigation redirect() throws to halt execution — a bare jest.fn()
// would let this file's code run past it into the next lines, which assume a
// real factor exists. Matches the real control flow.
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true, retryAfterSeconds: 0 }),
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a moment, then try again.",
}));
jest.mock("@/lib/auth/redirect-after-login", () => ({
  resolveLoginDestination: jest.fn().mockResolvedValue("/patient"),
}));

const stampActivityCookie = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/auth/idle-timeout", () => ({
  stampActivityCookie: (...args: unknown[]) => stampActivityCookie(...args),
}));

const listFactors = jest.fn();
const challenge = jest.fn();
const verify = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { mfa: { listFactors, challenge, verify } },
  }),
  getCurrentUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

import { verifyLoginMfaChallenge } from "./actions";

function codeFormData(code: string) {
  const fd = new FormData();
  fd.set("code", code);
  return fd;
}

/** Calls the action and swallows the mocked redirect()'s thrown "NEXT_REDIRECT"
 * — a real redirect() throws the same way, so callers that reach it never see
 * a return value; only the cookie-stamping side effect matters to these tests. */
async function callVerify(formData: FormData) {
  try {
    await verifyLoginMfaChallenge(undefined, formData);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
  }
}

beforeEach(() => {
  stampActivityCookie.mockReset().mockResolvedValue(undefined);
  listFactors.mockReset();
  challenge.mockReset();
  verify.mockReset();
});

describe("verifyLoginMfaChallenge — stale-cookie regression", () => {
  it("stamps a fresh activity cookie after a successful TOTP verification", async () => {
    listFactors.mockResolvedValue({ data: { totp: [{ id: "factor-1", status: "verified" }] } });
    challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verify.mockResolvedValue({ error: null });

    await callVerify(codeFormData("123456"));

    expect(stampActivityCookie).toHaveBeenCalledTimes(1);
  });

  it("stamps a fresh activity cookie on the 'nothing enrolled after all' fallback path too", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] } });

    await callVerify(codeFormData("123456"));

    expect(stampActivityCookie).toHaveBeenCalledTimes(1);
  });

  it("does NOT stamp when the code is wrong", async () => {
    listFactors.mockResolvedValue({ data: { totp: [{ id: "factor-1", status: "verified" }] } });
    challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verify.mockResolvedValue({ error: { message: "invalid code" } });

    await verifyLoginMfaChallenge(undefined, codeFormData("000000"));

    expect(stampActivityCookie).not.toHaveBeenCalled();
  });
});

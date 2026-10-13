/**
 * A programme code typed at sign-up (S03b, spec 1.8, OQ-41), through the real sign-up actions.
 *
 * Pinned here:
 *  - a valid code is held PENDING in the new account's metadata (cohort_code) and nothing is joined or claimed by the action;
 *  - a code that fails the check stops the sign-up before any account is created, naming the field;
 *  - no code typed means no metadata key at all and no check (the common path is unchanged);
 *  - both the phone and the email sign-up carry it.
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
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ auth: { signUp: signUpMock } }),
}));
jest.mock("@/lib/auth/redirect-after-login", () => ({ redirectAfterLogin: jest.fn() }));
jest.mock("@/lib/auth/backfill-signup-metadata", () => ({ backfillSignupMetadata: jest.fn() }));

const readCohort = jest.fn();
jest.mock("@/lib/auth/signup-cohort-code", () => ({ readSignupCohortCode: (...a: unknown[]) => readCohort(...a) }));

import { signUp, signUpWithPhone } from "./actions";

function phoneForm(overrides: Record<string, string> = {}) {
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
function emailForm(overrides: Record<string, string> = {}) {
  const fd = phoneForm({ email: "amaka@example.ng", ...overrides });
  return fd;
}

beforeEach(() => {
  signUpMock.mockReset().mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
  readCohort.mockReset().mockResolvedValue({ ok: true, code: null });
  rateLimitMock.mockReset().mockResolvedValue({ success: true });
});

describe("phone sign-up with a programme code", () => {
  it("holds a valid code pending in the account metadata", async () => {
    readCohort.mockResolvedValue({ ok: true, code: "GRPA2345" });
    const res = await signUpWithPhone(undefined, phoneForm({ cohortCode: "grpa-2345" }));
    expect(res).toMatchObject({ step: "verify" });
    expect(signUpMock.mock.calls[0]?.[0].options.data).toMatchObject({ cohort_code: "GRPA2345" });
  });

  it("stops before creating any account when the code fails, and names the field", async () => {
    readCohort.mockResolvedValue({ ok: false, error: "That programme code is not valid or has expired." });
    const res = await signUpWithPhone(undefined, phoneForm({ cohortCode: "NOPE9999" }));
    expect(res).toEqual({ error: "That programme code is not valid or has expired.", field: "cohortCode" });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("leaves the metadata alone when no code was typed", async () => {
    await signUpWithPhone(undefined, phoneForm());
    expect(signUpMock.mock.calls[0]?.[0].options.data).not.toHaveProperty("cohort_code");
  });
});

describe("email sign-up with a programme code", () => {
  it("holds a valid code pending in the account metadata", async () => {
    readCohort.mockResolvedValue({ ok: true, code: "GRPA2345" });
    await signUp(undefined, emailForm({ cohortCode: "GRPA2345" }));
    expect(signUpMock.mock.calls[0]?.[0].options.data).toMatchObject({ cohort_code: "GRPA2345" });
  });

  it("stops before creating any account when the code fails", async () => {
    readCohort.mockResolvedValue({ ok: false, error: "That programme code is not valid or has expired." });
    const res = await signUp(undefined, emailForm({ cohortCode: "NOPE9999" }));
    expect(res).toMatchObject({ field: "cohortCode" });
    expect(signUpMock).not.toHaveBeenCalled();
  });
});

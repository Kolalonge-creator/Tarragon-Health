/**
 * On a project with email confirmations disabled (this one, currently),
 * `supabase.auth.signUp()` returns a live session immediately — there is no
 * confirmation email to wait for. signUp() used to ignore that and always
 * return `{ success: true }`, which rendered SignupForm's "Check your email
 * to confirm your account, then sign in" message even though no email was
 * ever sent and the visitor was already signed in. Live behaviour observed
 * 2026-09-25: a real signup completed and auto-logged the user in per
 * GoTrue's own audit log (`immediate_login_after_signup: true`), yet the UI
 * told them to go check an email that would never arrive.
 *
 * Fixed by redirecting straight to the resolved destination whenever
 * `signUp()` hands back a session, via the same `redirectAfterLogin` helper
 * login/actions.ts uses for a successful sign-in. That redirect means this
 * path never reaches /auth/callback — the only other place that backfills
 * profiles.phone/state and redeems a carried referral code — so signUp()
 * must call backfillSignupMetadata() itself first (caught in code review
 * before this fix ever merged; see backfill-signup-metadata.ts).
 */

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map([["origin", "https://app.tarragonhealth.ng"]])),
}));

jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true }),
  RATE_LIMIT_MESSAGE: "Too many attempts.",
}));

const signUpMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ auth: { signUp: signUpMock } }),
}));

const redirectAfterLoginMock = jest.fn().mockImplementation((_supabase, destination) => {
  throw new Error(`NEXT_REDIRECT:${destination ?? "unset"}`);
});
jest.mock("@/lib/auth/redirect-after-login", () => ({
  redirectAfterLogin: (...args: unknown[]) => redirectAfterLoginMock(...args),
}));

const backfillSignupMetadataMock = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/auth/backfill-signup-metadata", () => ({
  backfillSignupMetadata: (...args: unknown[]) => backfillSignupMetadataMock(...args),
}));

import { signUp } from "./actions";

function formDataFor(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("firstName", "Amaka");
  fd.set("lastName", "Okoro");
  fd.set("email", "amaka@example.com");
  fd.set("countryCode", "+234");
  fd.set("phone", "8012345678");
  fd.set("state", "");
  fd.set("password", "a-strong-password-123");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

describe("signUp — auto-confirm redirects instead of claiming an email was sent", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    redirectAfterLoginMock.mockClear();
    backfillSignupMetadataMock.mockClear();
  });

  it("backfills signup metadata and redirects when signUp hands back a live session", async () => {
    const user = { id: "user-123", user_metadata: { ref_code: "FRIEND10" } };
    signUpMock.mockResolvedValue({
      data: { user, session: { access_token: "tok" } },
      error: null,
    });

    await expect(signUp(undefined, formDataFor())).rejects.toThrow("NEXT_REDIRECT");

    // Must run before the redirect, not after — a thrown NEXT_REDIRECT from
    // redirectAfterLogin would otherwise skip it entirely.
    expect(backfillSignupMetadataMock).toHaveBeenCalledWith(expect.anything(), user);
    expect(redirectAfterLoginMock).toHaveBeenCalledWith(expect.anything(), "user-123", null);
  });

  it("falls back to the 'check your email' success state when no session comes back", async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: "user-123" }, session: null },
      error: null,
    });

    const result = await signUp(undefined, formDataFor());

    expect(result).toEqual({ success: true });
    expect(backfillSignupMetadataMock).not.toHaveBeenCalled();
    expect(redirectAfterLoginMock).not.toHaveBeenCalled();
  });

  it("still falls back to the success state when the mock omits data entirely", async () => {
    // Matches redirect-threading.test.ts's existing mock shape — must not throw.
    signUpMock.mockResolvedValue({ error: null });

    const result = await signUp(undefined, formDataFor());

    expect(result).toEqual({ success: true });
  });
});

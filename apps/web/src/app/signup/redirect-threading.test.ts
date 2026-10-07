/**
 * signUp() must thread a sanitized redirectTo through to Supabase's
 * emailRedirectTo, so a brand-new recipient who arrived at /signup from a
 * sponsored_service_reservations claim link (/claim/[token]) lands back on
 * it after confirming their email — not on their generic role home page.
 * apps/web/src/app/auth/callback/route.ts already reads a `redirect` query
 * param off the confirmation link it receives; this only had to write it.
 * Found missing in code review before this feature ever merged.
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

describe("signUp — redirect threading", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    signUpMock.mockResolvedValue({ error: null });
  });

  it("threads a sanitized redirectTo into emailRedirectTo as a ?redirect= param", async () => {
    await signUp(undefined, formDataFor({ redirectTo: "/claim/tok_abc123" }));

    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.tarragonhealth.ng/auth/callback?redirect=%2Fclaim%2Ftok_abc123",
        }),
      })
    );
  });

  it("omits the ?redirect= param entirely when no redirectTo was given", async () => {
    await signUp(undefined, formDataFor());

    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.tarragonhealth.ng/auth/callback",
        }),
      })
    );
  });

  it("never carries an off-site redirectTo into the confirmation email (open-redirect guard)", async () => {
    await signUp(undefined, formDataFor({ redirectTo: "https://evil.example.com/phish" }));

    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.tarragonhealth.ng/auth/callback",
        }),
      })
    );
  });
});

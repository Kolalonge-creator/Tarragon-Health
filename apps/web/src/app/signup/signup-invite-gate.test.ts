/**
 * Invite-only sign-up (the pilot invite list): the kind pre-check in the sign-up actions. The database trigger on auth.users is the real
 * gate (packages/db/tests/signup_invite_list.sql); these pin what the app does around it:
 *  - when sign-up is closed to this person, the action says so kindly and creates nothing (GoTrue is never asked);
 *  - when it is open to them, the invite code travels in the account metadata so the trigger can use it;
 *  - the pre-check is asked with the normalised phone and the code, never anything else.
 */
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map([["origin", "https://app.tarragonhealth.ng"]])),
  cookies: jest.fn().mockResolvedValue({ get: () => undefined }),
}));
jest.mock("@/lib/rate-limit", () => ({ checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true }), RATE_LIMIT_MESSAGE: "Too many attempts." }));

const signUpMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ auth: { signUp: signUpMock } }) }));
jest.mock("@/lib/auth/redirect-after-login", () => ({ redirectAfterLogin: jest.fn() }));
jest.mock("@/lib/auth/backfill-signup-metadata", () => ({ backfillSignupMetadata: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@tarragon/auth/password-check", () => ({ checkPasswordAcceptable: jest.fn().mockResolvedValue({ acceptable: true }) }));
jest.mock("@/lib/auth/check-new-password", () => ({ checkNewPassword: jest.fn().mockResolvedValue({ ok: true }) }));

const gateMock = jest.fn();
jest.mock("@/lib/auth/signup-gate", () => ({ checkSignupGate: (...a: unknown[]) => gateMock(...a) }));

import { signUp, signUpWithPhone } from "@/app/signup/actions";

function phoneForm(extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("firstName", "Amaka");
  fd.set("lastName", "Okoro");
  fd.set("countryCode", "+234");
  fd.set("phone", "0803 123 4567");
  fd.set("state", "");
  fd.set("password", "a-strong-password-123");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
function emailForm(extra: Record<string, string> = {}) {
  const fd = phoneForm(extra);
  fd.set("email", "amaka@example.com");
  return fd;
}

beforeEach(() => {
  signUpMock.mockReset().mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
  gateMock.mockReset().mockResolvedValue({ inviteOnly: false, allowed: true });
});

describe("phone sign-up with the invite gate", () => {
  it("refuses kindly and asks GoTrue for nothing when sign-up is closed to this person", async () => {
    gateMock.mockResolvedValue({ inviteOnly: true, allowed: false });
    const result = await signUpWithPhone(undefined, phoneForm());
    expect(result).toMatchObject({ field: "inviteCode" });
    expect(result?.error).toMatch(/by invitation/);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("asks the pre-check with the normalised phone and the code, and carries the code into the account metadata", async () => {
    await signUpWithPhone(undefined, phoneForm({ inviteCode: "ABCD2345EF" }));
    expect(gateMock).toHaveBeenCalledWith({ phone: "+2348031234567", inviteCode: "ABCD2345EF" });
    expect(signUpMock.mock.calls[0][0].options.data.invite_code).toBe("ABCD2345EF");
  });

  it("sends no invite_code at all when none was given", async () => {
    await signUpWithPhone(undefined, phoneForm());
    expect(signUpMock.mock.calls[0][0].options.data).not.toHaveProperty("invite_code");
  });
});

describe("email sign-up with the invite gate", () => {
  it("refuses kindly and creates nothing when closed", async () => {
    gateMock.mockResolvedValue({ inviteOnly: true, allowed: false });
    const result = await signUp(undefined, emailForm());
    expect(result).toMatchObject({ field: "inviteCode" });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("passes only the email and the code to the pre-check, and the code to the account", async () => {
    await signUp(undefined, emailForm({ inviteCode: "ABCD2345EF" }));
    // the unverified phone typed on the email form is deliberately NOT sent to the gate
    expect(gateMock).toHaveBeenCalledWith({ email: "amaka@example.com", inviteCode: "ABCD2345EF" });
    expect(signUpMock.mock.calls[0][0].options.data.invite_code).toBe("ABCD2345EF");
  });
});

/**
 * Server actions for the S03b recovery routes and the OQ-43 hold on recovery by a text code.
 *
 * Pinned here:
 *  - a wrong code reads the same on the form whatever the reason, and a password mismatch never reaches the server logic;
 *  - a successful backup-code recovery signs the person in with the new password (email or phone) and lands them in the app;
 *  - the contact route's two forms give the same answer whether or not anything exists;
 *  - verifyPhoneReset: after a correct code, a recent number change signs the person OUT, says until when, and never redirects
 *    to the reset page; an unreadable hold fails CLOSED; a clear hold goes on to /reset-password.
 */

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map([["origin", "https://app.tarragonhealth.ng"]])),
  cookies: jest.fn().mockResolvedValue({ get: () => undefined }),
}));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

const rateLimitMock = jest.fn();
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: (...a: unknown[]) => rateLimitMock(...a),
  RATE_LIMIT_MESSAGE: "Too many attempts.",
}));

const recoverWithBackupCode = jest.fn();
const askRecoveryContact = jest.fn();
const sendContactRecoveryLink = jest.fn();
jest.mock("@/lib/auth/recovery/recovery-routes", () => ({
  recoverWithBackupCode: (...a: unknown[]) => recoverWithBackupCode(...a),
  askRecoveryContact: (...a: unknown[]) => askRecoveryContact(...a),
  sendContactRecoveryLink: (...a: unknown[]) => sendContactRecoveryLink(...a),
}));

const signInWithPassword = jest.fn();
const verifyOtp = jest.fn();
const signOut = jest.fn();
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { signInWithPassword, verifyOtp, signOut, resetPasswordForEmail: jest.fn(), signInWithOtp: jest.fn() },
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));

const redirectAfterLogin = jest.fn().mockImplementation(() => {
  throw new Error("NEXT_REDIRECT:signed-in");
});
jest.mock("@/lib/auth/redirect-after-login", () => ({ redirectAfterLogin: (...a: unknown[]) => redirectAfterLogin(...a) }));

import { askRecoveryContactAction, recoverWithBackupCodeAction, sendContactRecoveryLinkAction } from "./recovery-actions";
import { verifyPhoneReset } from "./actions";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const backupForm = (o: Record<string, string> = {}) =>
  form({ identifier: "ada@example.ng", code: "ABCDE-FGHJK", password: "a-long-new-passphrase", confirmPassword: "a-long-new-passphrase", ...o });

beforeEach(() => {
  jest.clearAllMocks();
  rateLimitMock.mockResolvedValue({ success: true });
});

describe("recoverWithBackupCodeAction", () => {
  it("does not call the recovery logic when the two passwords differ", async () => {
    const res = await recoverWithBackupCodeAction(undefined, backupForm({ confirmPassword: "different-passphrase" }));
    expect(res?.field).toBe("confirmPassword");
    expect(recoverWithBackupCode).not.toHaveBeenCalled();
  });

  it("reads every wrong code the same", async () => {
    recoverWithBackupCode.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await recoverWithBackupCodeAction(undefined, backupForm());
    expect(res).toEqual({ error: expect.stringContaining("That did not work"), field: "code" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("explains a weak password on the password field and a limit plainly", async () => {
    recoverWithBackupCode.mockResolvedValue({ ok: false, reason: "weak_password", message: "Too short." });
    expect(await recoverWithBackupCodeAction(undefined, backupForm())).toEqual({ error: "Too short.", field: "password" });
    recoverWithBackupCode.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect(await recoverWithBackupCodeAction(undefined, backupForm())).toEqual({ error: "Too many attempts." });
  });

  it("signs in with the new password by email and goes into the app", async () => {
    recoverWithBackupCode.mockResolvedValue({ ok: true, signInWith: { kind: "email", value: "ada@example.ng" } });
    signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(recoverWithBackupCodeAction(undefined, backupForm())).rejects.toThrow("NEXT_REDIRECT:signed-in");
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "ada@example.ng", password: "a-long-new-passphrase" });
    expect(redirectAfterLogin).toHaveBeenCalledWith(expect.anything(), "u1", null);
  });

  it("signs in by phone for a phone identifier", async () => {
    recoverWithBackupCode.mockResolvedValue({ ok: true, signInWith: { kind: "phone", value: "+2348031234567" } });
    signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(recoverWithBackupCodeAction(undefined, backupForm({ identifier: "08031234567" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(signInWithPassword).toHaveBeenCalledWith({ phone: "+2348031234567", password: "a-long-new-passphrase" });
  });

  it("when the password changed but sign-in did not work, says so and does not error", async () => {
    recoverWithBackupCode.mockResolvedValue({ ok: true, signInWith: { kind: "email", value: "ada@example.ng" } });
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "x" } });
    const res = await recoverWithBackupCodeAction(undefined, backupForm());
    expect(res).toMatchObject({ success: true });
    expect(redirectAfterLogin).not.toHaveBeenCalled();
  });
});

describe("contact route actions", () => {
  it("ask: the same success text however it went, a plain message for a typo and a limit", async () => {
    askRecoveryContact.mockResolvedValue({ ok: true });
    const ok = await askRecoveryContactAction(undefined, form({ identifier: "ada@example.ng" }));
    expect(ok).toMatchObject({ success: true });
    askRecoveryContact.mockResolvedValue({ ok: false, reason: "invalid_input" });
    expect((await askRecoveryContactAction(undefined, form({ identifier: "x" })))?.field).toBe("identifier");
    askRecoveryContact.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect(await askRecoveryContactAction(undefined, form({ identifier: "ada@example.ng" }))).toEqual({ error: "Too many attempts." });
  });

  it("send: hands the sender only the Auth calls, with the redirect to this site's reset page", async () => {
    sendContactRecoveryLink.mockResolvedValue({ ok: true });
    const res = await sendContactRecoveryLinkAction(undefined, form({ identifier: "ada@example.ng" }));
    expect(res).toMatchObject({ success: true });
    const sender = sendContactRecoveryLink.mock.calls[0]?.[1] as { email: unknown; phoneCode: unknown };
    expect(typeof sender.email).toBe("function");
    expect(typeof sender.phoneCode).toBe("function");
  });
});

describe("verifyPhoneReset and the hold after a recent number change (OQ-43)", () => {
  const verifyForm = () => form({ phone: "+2348031234567", token: "123456" });

  beforeEach(() => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it("goes on to /reset-password when nothing is held", async () => {
    rpc.mockResolvedValue({ data: { held: false }, error: null });
    await expect(verifyPhoneReset(undefined, verifyForm())).rejects.toThrow("NEXT_REDIRECT:/reset-password");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs the person out, says until when in Lagos time, and does NOT redirect when held", async () => {
    rpc.mockResolvedValue({ data: { held: true, until: "2026-10-16T17:30:00Z" }, error: null });
    const res = await verifyPhoneReset(undefined, verifyForm());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res?.error).toContain("16 Oct 2026, 18:30");
    expect(res?.error).toMatch(/email link, a backup code or your recovery contact/);
    expect(res).toMatchObject({ step: "verify", phone: "+2348031234567" });
  });

  it("fails CLOSED when the hold cannot be read: signed out, no redirect", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await verifyPhoneReset(undefined, verifyForm());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res?.error).toBeTruthy();
    expect(res).toMatchObject({ step: "verify" });
  });

  it("a wrong code never even asks about the hold", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Token has expired or is invalid" } });
    await verifyPhoneReset(undefined, verifyForm());
    expect(rpc).not.toHaveBeenCalled();
  });
});

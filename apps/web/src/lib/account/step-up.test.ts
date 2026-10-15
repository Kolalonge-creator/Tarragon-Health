/**
 * The password step-up (S03b): the password is checked with a throw-away client against a VERIFIED channel read from Auth, the
 * throw-away session is ended, and only then does the server record the step-up for the right purpose.
 */

const reportMock = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => reportMock(...a) }));

const rateLimitMock = jest.fn();
jest.mock("@/lib/rate-limit", () => ({ checkAuthRateLimit: (...a: unknown[]) => rateLimitMock(...a) }));

const svcRpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => svcRpc(...a) }) }));

const signInWithPassword = jest.fn();
const signOut = jest.fn();
jest.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword, signOut } }) }));

import { sessionIdFromAccessToken, verifyPasswordAndRecordStepUp } from "./step-up";

const SESSION = "11111111-aaaa-4bbb-8ccc-222222222222";
const BOTH = { id: "u1", email: "ada@example.ng", email_confirmed_at: "2026-01-01", phone: "2348031234567", phone_confirmed_at: "2026-01-01" };

beforeEach(() => {
  jest.clearAllMocks();
  rateLimitMock.mockResolvedValue({ success: true });
  signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null });
  signOut.mockResolvedValue({ error: null });
  svcRpc.mockResolvedValue({ data: true, error: null });
});

describe("verifyPasswordAndRecordStepUp", () => {
  it("checks the password against the verified EMAIL from Auth, ends the throw-away session, then records the purpose", async () => {
    expect(await verifyPasswordAndRecordStepUp(BOTH, "secret-passphrase", "backup_codes", SESSION)).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "ada@example.ng", password: "secret-passphrase" });
    // LOCAL: signOut() defaults to every session of the account, which would also end the one the person is typing in
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(svcRpc).toHaveBeenCalledWith("record_step_up", { p_user: "u1", p_purpose: "backup_codes", p_session: SESSION });
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(svcRpc.mock.invocationCallOrder[0]);
  });

  it("uses the verified phone when there is no verified email", async () => {
    await verifyPasswordAndRecordStepUp({ ...BOTH, email_confirmed_at: null }, "secret-passphrase", "recovery_contact", SESSION);
    expect(signInWithPassword).toHaveBeenCalledWith({ phone: "+2348031234567", password: "secret-passphrase" });
    expect(svcRpc).toHaveBeenCalledWith("record_step_up", { p_user: "u1", p_purpose: "recovery_contact", p_session: SESSION });
  });

  it("records nothing for a wrong password, an empty one, or a password that signs in a DIFFERENT account", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Invalid login credentials" } });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "nope", "backup_codes", SESSION)).toEqual({ ok: false, reason: "wrong_password" });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "", "backup_codes", SESSION)).toEqual({ ok: false, reason: "wrong_password" });
    expect(signOut).not.toHaveBeenCalled();
    // a password that signs in a DIFFERENT account: refused, and the throw-away session it opened is still ended (locally)
    signInWithPassword.mockResolvedValue({ data: { user: { id: "someone-else" }, session: { access_token: "t" } }, error: null });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "x", "backup_codes", SESSION)).toEqual({ ok: false, reason: "wrong_password" });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("has no route when nothing is verified, and is rate limited per account", async () => {
    expect(await verifyPasswordAndRecordStepUp({ id: "u1", email: "a@b.co", email_confirmed_at: null }, "x", "backup_codes", SESSION)).toEqual({ ok: false, reason: "no_password_route" });
    rateLimitMock.mockResolvedValue({ success: false });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "x", "backup_codes", SESSION)).toEqual({ ok: false, reason: "rate_limited" });
    expect(rateLimitMock).toHaveBeenCalledWith("step-up", "u1", expect.anything(), expect.anything());
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("when the step-up cannot be recorded it says so, reporting nothing identifying", async () => {
    svcRpc.mockResolvedValue({ data: null, error: { message: "db" } });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "secret-passphrase", "backup_codes", SESSION)).toEqual({ ok: false, reason: "unavailable" });
    const reported = JSON.stringify(reportMock.mock.calls);
    for (const secret of ["secret-passphrase", "ada@example.ng", "u1"]) expect(reported).not.toContain(secret);
  });
});

describe("a step-up is bound to a session", () => {
  it("refuses to record one when the session cannot be identified (fail closed), and checks nothing first", async () => {
    expect(await verifyPasswordAndRecordStepUp(BOTH, "secret-passphrase", "backup_codes", null)).toEqual({ ok: false, reason: "unavailable" });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(svcRpc).not.toHaveBeenCalled();
  });
});

describe("sessionIdFromAccessToken", () => {
  const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  it("reads the session_id claim", () => {
    expect(sessionIdFromAccessToken(token({ session_id: SESSION }))).toBe(SESSION);
  });
  it("returns null for anything else", () => {
    for (const bad of [undefined, null, "", "nodots", "a.b", token({}), token({ session_id: 7 }), token({ session_id: "short" }), token({ session_id: "x".repeat(80) }), "a.%%%.c"]) {
      expect(sessionIdFromAccessToken(bad as string | null | undefined)).toBeNull();
    }
  });
});

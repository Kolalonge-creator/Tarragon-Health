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

import { verifyPasswordAndRecordStepUp } from "./step-up";

const BOTH = { id: "u1", email: "ada@example.ng", email_confirmed_at: "2026-01-01", phone: "2348031234567", phone_confirmed_at: "2026-01-01" };

beforeEach(() => {
  jest.clearAllMocks();
  rateLimitMock.mockResolvedValue({ success: true });
  signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  signOut.mockResolvedValue({ error: null });
  svcRpc.mockResolvedValue({ data: true, error: null });
});

describe("verifyPasswordAndRecordStepUp", () => {
  it("checks the password against the verified EMAIL from Auth, ends the throw-away session, then records the purpose", async () => {
    expect(await verifyPasswordAndRecordStepUp(BOTH, "secret-passphrase", "backup_codes")).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "ada@example.ng", password: "secret-passphrase" });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(svcRpc).toHaveBeenCalledWith("record_step_up", { p_user: "u1", p_purpose: "backup_codes" });
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(svcRpc.mock.invocationCallOrder[0]);
  });

  it("uses the verified phone when there is no verified email", async () => {
    await verifyPasswordAndRecordStepUp({ ...BOTH, email_confirmed_at: null }, "secret-passphrase", "recovery_contact");
    expect(signInWithPassword).toHaveBeenCalledWith({ phone: "+2348031234567", password: "secret-passphrase" });
    expect(svcRpc).toHaveBeenCalledWith("record_step_up", { p_user: "u1", p_purpose: "recovery_contact" });
  });

  it("records nothing for a wrong password, an empty one, or a password that signs in a DIFFERENT account", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "Invalid login credentials" } });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "nope", "backup_codes")).toEqual({ ok: false, reason: "wrong_password" });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "", "backup_codes")).toEqual({ ok: false, reason: "wrong_password" });
    signInWithPassword.mockResolvedValue({ data: { user: { id: "someone-else" } }, error: null });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "x", "backup_codes")).toEqual({ ok: false, reason: "wrong_password" });
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("has no route when nothing is verified, and is rate limited per account", async () => {
    expect(await verifyPasswordAndRecordStepUp({ id: "u1", email: "a@b.co", email_confirmed_at: null }, "x", "backup_codes")).toEqual({ ok: false, reason: "no_password_route" });
    rateLimitMock.mockResolvedValue({ success: false });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "x", "backup_codes")).toEqual({ ok: false, reason: "rate_limited" });
    expect(rateLimitMock).toHaveBeenCalledWith("step-up", "u1", expect.anything(), expect.anything());
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("when the step-up cannot be recorded it says so, reporting nothing identifying", async () => {
    svcRpc.mockResolvedValue({ data: null, error: { message: "db" } });
    expect(await verifyPasswordAndRecordStepUp(BOTH, "secret-passphrase", "backup_codes")).toEqual({ ok: false, reason: "unavailable" });
    const reported = JSON.stringify(reportMock.mock.calls);
    for (const secret of ["secret-passphrase", "ada@example.ng", "u1"]) expect(reported).not.toContain(secret);
  });
});

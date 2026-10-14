/**
 * The two no-session recovery routes (S03b): backup codes and the Care Circle recovery contact.
 *
 * Pinned here:
 *  - a malformed identifier or code, a weak password and a rate-limited caller never reach the database, and a weak password
 *    never spends a code;
 *  - every wrong code reads the same ("invalid"), whatever the reason;
 *  - the password is set only after the code is redeemed AND every other session has been ended (so the step that makes the
 *    recovery protect anything can never be the one that fails open); if either fails the code is given back;
 *  - nothing secret (code, password, number, address) is ever reported;
 *  - the contact route answers {ok:true} for a well-formed identifier whether or not anything exists, the link goes only to a
 *    channel Auth reports as VERIFIED, the address comes from Auth (never the request), and a failed send reopens the request.
 */

const reportMock = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => reportMock(...a) }));

const rateLimitMock = jest.fn();
jest.mock("@/lib/rate-limit", () => ({ checkAuthRateLimit: (...a: unknown[]) => rateLimitMock(...a) }));

const rpc = jest.fn();
const updateUserById = jest.fn();
const getUserById = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpc(...a), auth: { admin: { updateUserById, getUserById } } }),
}));

import { askRecoveryContact, recoverWithBackupCode, sendContactRecoveryLink } from "./recovery-routes";

const USER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const CODE = "ABCDE-FGHJK";
const PASSWORD = "a-long-new-passphrase";

beforeEach(() => {
  jest.clearAllMocks();
  rateLimitMock.mockResolvedValue({ success: true });
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  updateUserById.mockResolvedValue({ error: null });
});

describe("recoverWithBackupCode", () => {
  it("never reaches the database for a malformed identifier or code", async () => {
    for (const [identifier, code] of [["", CODE], ["nobody", CODE], ["ada@example.ng", ""], ["ada@example.ng", "ABCDE-FGHJ0"], ["ada@example.ng", "short"]]) {
      expect(await recoverWithBackupCode({ identifier, code, newPassword: PASSWORD })).toEqual({ ok: false, reason: "invalid" });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it("refuses a weak password before the code is touched, so it never spends a code", async () => {
    const res = await recoverWithBackupCode({ identifier: "ada@example.ng", code: CODE, newPassword: "short" });
    expect(res).toMatchObject({ ok: false, reason: "weak_password" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is rate limited on the IP and the identifier and then does nothing", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    expect(await recoverWithBackupCode({ identifier: "08031234567", code: CODE, newPassword: PASSWORD })).toEqual({ ok: false, reason: "rate_limited" });
    expect(rateLimitMock).toHaveBeenCalledWith("backup-code", "+2348031234567", expect.anything(), expect.anything());
    expect(rpc).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("reads every wrong code the same and sets no password", async () => {
    rpc.mockResolvedValue({ data: { ok: false }, error: null });
    expect(await recoverWithBackupCode({ identifier: "ada@example.ng", code: CODE, newPassword: PASSWORD })).toEqual({ ok: false, reason: "invalid" });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("passes the normalised identifier and code, ends the other sessions, THEN sets the password for the account the database named", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "redeem_backup_code" ? { data: { ok: true, user_id: USER, remaining: 9 }, error: null } : { data: { ok: true }, error: null },
    );
    const res = await recoverWithBackupCode({ identifier: " Ada@Example.NG ", code: "abcde fghjk", newPassword: PASSWORD });
    expect(res).toEqual({ ok: true, signInWith: { kind: "email", value: "ada@example.ng" } });
    expect(rpc).toHaveBeenNthCalledWith(1, "redeem_backup_code", { p_kind: "email", p_identifier: "ada@example.ng", p_code: "ABCDEFGHJK" });
    expect(updateUserById).toHaveBeenCalledWith(USER, { password: PASSWORD });
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_backup_code_recovery", { p_user: USER });
    // order: redeem, then end the sessions, then the password
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(updateUserById.mock.invocationCallOrder[0]);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[1]);
  });

  it("gives the code back when the password could not be set, and reports without any secret", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "redeem_backup_code" ? { data: { ok: true, user_id: USER }, error: null } : { data: { ok: true }, error: null },
    );
    updateUserById.mockResolvedValue({ error: { message: "boom" } });
    expect(await recoverWithBackupCode({ identifier: "ada@example.ng", code: CODE, newPassword: PASSWORD })).toEqual({ ok: false, reason: "unavailable" });
    expect(rpc).toHaveBeenCalledWith("release_backup_code", { p_user: USER, p_code: "ABCDEFGHJK" });
    const reported = JSON.stringify(reportMock.mock.calls);
    expect(reportMock).toHaveBeenCalled();
    for (const secret of [PASSWORD, "ABCDEFGHJK", "ada@example.ng", USER]) expect(reported).not.toContain(secret);
  });

  it("does NOT change the password when the other sessions cannot be ended, and gives the code back", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "redeem_backup_code") return { data: { ok: true, user_id: USER }, error: null };
      if (fn === "complete_backup_code_recovery") return { data: null, error: { message: "x" } };
      return { data: true, error: null };
    });
    expect(await recoverWithBackupCode({ identifier: "ada@example.ng", code: CODE, newPassword: PASSWORD })).toEqual({ ok: false, reason: "unavailable" });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("release_backup_code", { p_user: USER, p_code: "ABCDEFGHJK" });
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("treats a completion that answers ok:false the same as a failure", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "redeem_backup_code" ? { data: { ok: true, user_id: USER }, error: null } : { data: { ok: false }, error: null },
    );
    expect(await recoverWithBackupCode({ identifier: "ada@example.ng", code: CODE, newPassword: PASSWORD })).toEqual({ ok: false, reason: "unavailable" });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("treats a database error on redeem as unavailable, not as a wrong code", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await recoverWithBackupCode({ identifier: "ada@example.ng", code: CODE, newPassword: PASSWORD })).toEqual({ ok: false, reason: "unavailable" });
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe("askRecoveryContact", () => {
  it("rejects a typo without touching anything and is rate limited otherwise", async () => {
    expect(await askRecoveryContact("hello")).toEqual({ ok: false, reason: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
    rateLimitMock.mockResolvedValue({ success: false });
    expect(await askRecoveryContact("ada@example.ng")).toEqual({ ok: false, reason: "rate_limited" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the same {ok:true} whether or not an account and a contact exist", async () => {
    rpc.mockResolvedValue({ data: { ok: false }, error: null });
    const none = await askRecoveryContact("ada@example.ng");
    rpc.mockResolvedValue({ data: { ok: true, request_id: REQUEST }, error: null });
    const some = await askRecoveryContact("ada@example.ng");
    expect(none).toEqual({ ok: true });
    expect(some).toEqual(none);
    expect(rpc).toHaveBeenCalledWith("request_contact_recovery", { p_kind: "email", p_identifier: "ada@example.ng" });
  });
});

describe("sendContactRecoveryLink", () => {
  const sender = () => ({
    email: jest.fn().mockResolvedValue({ error: null }),
    phoneCode: jest.fn().mockResolvedValue({ error: null }),
  });
  const claimed = () =>
    rpc.mockImplementation(async (fn: string) =>
      fn === "claim_contact_recovery" ? { data: { ok: true, user_id: USER, request_id: REQUEST }, error: null } : { data: true, error: null },
    );

  it("sends nothing and says the same thing when there is nothing to send", async () => {
    rpc.mockResolvedValue({ data: { ok: false }, error: null });
    const s = sender();
    expect(await sendContactRecoveryLink("ada@example.ng", s)).toEqual({ ok: true });
    expect(s.email).not.toHaveBeenCalled();
    expect(s.phoneCode).not.toHaveBeenCalled();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("emails the link to the VERIFIED address Auth holds, never one from the request, and not to the phone", async () => {
    claimed();
    getUserById.mockResolvedValue({ data: { user: { email: "real@example.ng", email_confirmed_at: "2026-01-01", phone: "2348031234567", phone_confirmed_at: "2026-01-01" } }, error: null });
    const s = sender();
    expect(await sendContactRecoveryLink("someone-else@example.ng", s)).toEqual({ ok: true });
    expect(s.email).toHaveBeenCalledWith("real@example.ng");
    expect(s.phoneCode).not.toHaveBeenCalled();
  });

  it("falls back to a code on the verified phone only when there is no verified email", async () => {
    claimed();
    getUserById.mockResolvedValue({ data: { user: { email: "unverified@example.ng", email_confirmed_at: null, phone: "2348031234567", phone_confirmed_at: "2026-01-01" } }, error: null });
    const s = sender();
    await sendContactRecoveryLink("08031234567", s);
    expect(s.email).not.toHaveBeenCalled();
    expect(s.phoneCode).toHaveBeenCalledWith("+2348031234567");
  });

  it("reopens the request and reports when there is no verified channel, or the send fails, without naming anyone", async () => {
    claimed();
    getUserById.mockResolvedValue({ data: { user: { email: "x@example.ng", email_confirmed_at: null, phone: null, phone_confirmed_at: null } }, error: null });
    expect(await sendContactRecoveryLink("ada@example.ng", sender())).toEqual({ ok: false, reason: "unavailable" });
    expect(rpc).toHaveBeenCalledWith("unrelease_contact_recovery", { p_request: REQUEST });

    rpc.mockClear();
    claimed();
    getUserById.mockResolvedValue({ data: { user: { email: "real@example.ng", email_confirmed_at: "2026-01-01" } }, error: null });
    const failing = { email: jest.fn().mockResolvedValue({ error: { message: "smtp" } }), phoneCode: jest.fn() };
    expect(await sendContactRecoveryLink("ada@example.ng", failing)).toEqual({ ok: false, reason: "unavailable" });
    expect(rpc).toHaveBeenCalledWith("unrelease_contact_recovery", { p_request: REQUEST });
    const reported = JSON.stringify(reportMock.mock.calls);
    for (const secret of ["real@example.ng", "ada@example.ng", USER, REQUEST]) expect(reported).not.toContain(secret);
  });

  it("is rate limited and rejects a typo without a claim", async () => {
    expect(await sendContactRecoveryLink("nope", sender())).toEqual({ ok: false, reason: "invalid_input" });
    rateLimitMock.mockResolvedValue({ success: false });
    expect(await sendContactRecoveryLink("ada@example.ng", sender())).toEqual({ ok: false, reason: "rate_limited" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

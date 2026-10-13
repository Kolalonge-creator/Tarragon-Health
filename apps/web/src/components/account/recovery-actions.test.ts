/**
 * Signed-in recovery actions (S03b): the password step-up before backup codes can be made or a recovery contact named.
 *
 * Pinned here:
 *  - nothing reaches the database function without the step-up, and a wrong password records none;
 *  - the step-up is recorded for the matching purpose only after the password was verified;
 *  - the codes come back once, on success only; a daily limit reads plainly;
 *  - confirming a recovery request needs the tick; declining does not.
 */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpc = jest.fn();
const getCurrentUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: () => getCurrentUser(),
  createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }),
}));

const verify = jest.fn();
jest.mock("@/lib/account/step-up", () => ({ verifyPasswordAndRecordStepUp: (...a: unknown[]) => verify(...a) }));

import { confirmContactRecoveryAction, generateBackupCodesAction, proposeRecoveryContactAction } from "./recovery-actions";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const USER = { id: "u1", email: "ada@example.ng", email_confirmed_at: "2026-01-01" };
const MEMBER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  jest.clearAllMocks();
  getCurrentUser.mockResolvedValue(USER);
  verify.mockResolvedValue({ ok: true });
  rpc.mockResolvedValue({ data: ["ABCDE-FGHJK"], error: null });
});

describe("generateBackupCodesAction", () => {
  it("checks the password for the backup_codes purpose BEFORE asking the database, and returns the codes", async () => {
    const res = await generateBackupCodesAction(undefined, form({ password: "secret-passphrase" }));
    expect(res).toEqual({ codes: ["ABCDE-FGHJK"] });
    expect(verify).toHaveBeenCalledWith(USER, "secret-passphrase", "backup_codes");
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  it("a wrong password makes no codes and says so plainly", async () => {
    verify.mockResolvedValue({ ok: false, reason: "wrong_password" });
    const res = await generateBackupCodesAction(undefined, form({ password: "nope" }));
    expect(res?.error).toContain("not right");
    expect(res?.codes).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await generateBackupCodesAction(undefined, form({ password: "x" })))?.error).toBeTruthy();
    expect(verify).not.toHaveBeenCalled();
  });

  it("reads the daily limit plainly and any other failure generically, with no codes", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "backup_codes_rate_limited" } });
    expect((await generateBackupCodesAction(undefined, form({ password: "x" })))?.error).toContain("tomorrow");
    rpc.mockResolvedValue({ data: null, error: { message: "step_up_required" } });
    const res = await generateBackupCodesAction(undefined, form({ password: "x" }));
    expect(res?.error).toBeTruthy();
    expect(res?.codes).toBeUndefined();
  });
});

describe("proposeRecoveryContactAction", () => {
  it("records the recovery_contact step-up first and then asks the database", async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: "c1" }, error: null });
    expect(await proposeRecoveryContactAction(undefined, form({ memberId: MEMBER, password: "secret-passphrase" }))).toEqual({ ok: true });
    expect(verify).toHaveBeenCalledWith(USER, "secret-passphrase", "recovery_contact");
    expect(rpc).toHaveBeenCalledWith("propose_recovery_contact", { p_member: MEMBER });
  });

  it("a wrong password or a non-uuid member reaches nothing", async () => {
    verify.mockResolvedValue({ ok: false, reason: "wrong_password" });
    expect((await proposeRecoveryContactAction(undefined, form({ memberId: MEMBER, password: "nope" })))?.error).toContain("not right");
    expect((await proposeRecoveryContactAction(undefined, form({ memberId: "not-a-uuid", password: "x" })))?.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the database's refusals to plain words", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "already_set" }, error: null });
    expect((await proposeRecoveryContactAction(undefined, form({ memberId: MEMBER, password: "x" })))?.error).toContain("already have a recovery contact");
  });
});

describe("confirmContactRecoveryAction", () => {
  it("confirming needs the tick; declining does not", async () => {
    expect((await confirmContactRecoveryAction(undefined, form({ id: MEMBER, decision: "confirm" })))?.error).toContain("Tick the box");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await confirmContactRecoveryAction(undefined, form({ id: MEMBER, decision: "confirm", sure: "on" }))).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("confirm_contact_recovery", { p_request: MEMBER, p_confirm: true });
    await confirmContactRecoveryAction(undefined, form({ id: MEMBER, decision: "decline" }));
    expect(rpc).toHaveBeenLastCalledWith("confirm_contact_recovery", { p_request: MEMBER, p_confirm: false });
  });
});

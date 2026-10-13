/**
 * Public recovery routes for the native app (S03b): malformed bodies are refused before any logic, every outcome maps to a status
 * that does not distinguish a wrong code from an unknown account, and nothing secret is echoed back.
 */

const recoverWithBackupCode = jest.fn();
const askRecoveryContact = jest.fn();
const sendContactRecoveryLink = jest.fn();
jest.mock("@/lib/auth/recovery/recovery-routes", () => ({
  recoverWithBackupCode: (...a: unknown[]) => recoverWithBackupCode(...a),
  askRecoveryContact: (...a: unknown[]) => askRecoveryContact(...a),
  sendContactRecoveryLink: (...a: unknown[]) => sendContactRecoveryLink(...a),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ auth: { resetPasswordForEmail: jest.fn(), signInWithOtp: jest.fn() } }),
}));

import { POST as backupPost } from "./backup-code/route";
import { POST as contactPost } from "./contact/route";

const req = (body: unknown) => new Request("https://x.test/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const BODY = { identifier: "ada@example.ng", code: "ABCDE-FGHJK", newPassword: "a-long-new-passphrase" };

beforeEach(() => jest.clearAllMocks());

describe("backup-code route", () => {
  it("400s on bad JSON and on a missing field without running the logic", async () => {
    expect((await backupPost(req("{nope"))).status).toBe(400);
    expect((await backupPost(req({ identifier: "a" }))).status).toBe(400);
    expect(recoverWithBackupCode).not.toHaveBeenCalled();
  });

  it("returns how to sign in on success, and nothing else", async () => {
    recoverWithBackupCode.mockResolvedValue({ ok: true, signInWith: { kind: "email", value: "ada@example.ng" } });
    const res = await backupPost(req(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, signInWith: { kind: "email", value: "ada@example.ng" } });
  });

  it("maps outcomes to statuses, with one body for every kind of wrong", async () => {
    recoverWithBackupCode.mockResolvedValue({ ok: false, reason: "invalid" });
    const wrong = await backupPost(req(BODY));
    expect([wrong.status, await wrong.json()]).toEqual([400, { ok: false, reason: "invalid" }]);
    recoverWithBackupCode.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect((await backupPost(req(BODY))).status).toBe(429);
    recoverWithBackupCode.mockResolvedValue({ ok: false, reason: "unavailable" });
    expect((await backupPost(req(BODY))).status).toBe(503);
    recoverWithBackupCode.mockResolvedValue({ ok: false, reason: "weak_password", message: "Too short." });
    const weak = await backupPost(req(BODY));
    expect([weak.status, await weak.json()]).toEqual([400, { ok: false, reason: "weak_password", message: "Too short." }]);
  });
});

describe("contact route", () => {
  it("400s on a bad action or body", async () => {
    expect((await contactPost(req({ action: "steal", identifier: "a@b.co" }))).status).toBe(400);
    expect((await contactPost(req("not json"))).status).toBe(400);
    expect(askRecoveryContact).not.toHaveBeenCalled();
  });

  it("ask and send both answer a bare {ok:true}", async () => {
    askRecoveryContact.mockResolvedValue({ ok: true });
    sendContactRecoveryLink.mockResolvedValue({ ok: true });
    for (const action of ["ask", "send"]) {
      const res = await contactPost(req({ action, identifier: "ada@example.ng" }));
      expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
    }
    expect(sendContactRecoveryLink.mock.calls[0]?.[0]).toBe("ada@example.ng");
  });

  it("maps a limit to 429, a typo to 400 and an outage to 503", async () => {
    askRecoveryContact.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect((await contactPost(req({ action: "ask", identifier: "ada@example.ng" }))).status).toBe(429);
    askRecoveryContact.mockResolvedValue({ ok: false, reason: "invalid_input" });
    expect((await contactPost(req({ action: "ask", identifier: "ada@example.ng" }))).status).toBe(400);
    askRecoveryContact.mockResolvedValue({ ok: false, reason: "unavailable" });
    expect((await contactPost(req({ action: "ask", identifier: "ada@example.ng" }))).status).toBe(503);
  });
});

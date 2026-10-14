import { contactRecoveryRemote, enforcePhoneRecoveryHold, recoverWithBackupCodeRemote, type HoldClient } from "./recovery-routes";

const BASE = "https://app.example.test";
type Init = { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal };
const reply = (status: number, body: unknown) =>
  jest.fn(async (...args: [string, Init]) => {
    void args;
    return { status, json: async () => body };
  });
const GOOD = { identifier: "ada@example.ng", code: "ABCDE-FGHJK", newPassword: "a-long-new-passphrase" };

describe("recoverWithBackupCodeRemote", () => {
  it("sends nothing when the identifier or the code cannot be real", async () => {
    const f = reply(200, {});
    for (const bad of [{ ...GOOD, identifier: "" }, { ...GOOD, identifier: "hello" }, { ...GOOD, code: "" }, { ...GOOD, code: "ABCDE-FGHJ0" }]) {
      expect(await recoverWithBackupCodeRemote(bad, f, BASE)).toEqual({ kind: "error", key: "auth.recovery.backup_failed" });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to the public route and returns how to sign in", async () => {
    const f = reply(200, { ok: true, signInWith: { kind: "email", value: "ada@example.ng" } });
    expect(await recoverWithBackupCodeRemote(GOOD, f, BASE)).toEqual({ kind: "ok", signInWith: { kind: "email", value: "ada@example.ng" } });
    expect(f.mock.calls[0]?.[0]).toBe(`${BASE}/api/auth/recovery/backup-code`);
    expect(f.mock.calls[0]?.[1].method).toBe("POST");
  });

  it("reads a phone sign-in answer as phone", async () => {
    const f = reply(200, { ok: true, signInWith: { kind: "phone", value: "+2348031234567" } });
    expect(await recoverWithBackupCodeRemote({ ...GOOD, identifier: "08031234567" }, f, BASE)).toEqual({ kind: "ok", signInWith: { kind: "phone", value: "+2348031234567" } });
  });

  it("maps every wrong to one message, a limit to the limit message, an outage to generic, and a lost connection to offline", async () => {
    expect(await recoverWithBackupCodeRemote(GOOD, reply(400, { ok: false, reason: "invalid" }), BASE)).toEqual({ kind: "error", key: "auth.recovery.backup_failed" });
    expect(await recoverWithBackupCodeRemote(GOOD, reply(429, { ok: false, reason: "rate_limited" }), BASE)).toEqual({ kind: "error", key: "auth.error.rate_limited" });
    expect(await recoverWithBackupCodeRemote(GOOD, reply(503, { ok: false, reason: "unavailable" }), BASE)).toEqual({ kind: "error", key: "auth.error.generic" });
    const weak = await recoverWithBackupCodeRemote(GOOD, reply(400, { ok: false, reason: "weak_password", message: "Too short." }), BASE);
    expect(weak).toEqual({ kind: "error", key: "auth.error.generic", message: "Too short." });
    const down = jest.fn(async (...args: [string, Init]): Promise<{ status: number; json(): Promise<unknown> }> => {
      void args;
      throw new Error("network");
    });
    expect(await recoverWithBackupCodeRemote(GOOD, down, BASE)).toEqual({ kind: "error", key: "auth.error.offline" });
  });

  it("does not treat a 200 without a sign-in answer as success", async () => {
    expect(await recoverWithBackupCodeRemote(GOOD, reply(200, { ok: true }), BASE)).toEqual({ kind: "error", key: "auth.recovery.backup_failed" });
  });
});

describe("contactRecoveryRemote", () => {
  it("rejects a typo locally and posts the action otherwise", async () => {
    const f = reply(200, { ok: true });
    expect(await contactRecoveryRemote("ask", "hello", f, BASE)).toEqual({ kind: "error", key: "auth.error.invalid_phone" });
    expect(f).not.toHaveBeenCalled();
    expect(await contactRecoveryRemote("send", "ada@example.ng", f, BASE)).toEqual({ kind: "done" });
    expect(f.mock.calls[0]?.[0]).toBe(`${BASE}/api/auth/recovery/contact`);
    expect(JSON.parse(f.mock.calls[0]?.[1].body as string)).toEqual({ action: "send", identifier: "ada@example.ng" });
  });

  it("maps a limit and an outage", async () => {
    expect(await contactRecoveryRemote("ask", "ada@example.ng", reply(429, {}), BASE)).toEqual({ kind: "error", key: "auth.error.rate_limited" });
    expect(await contactRecoveryRemote("ask", "ada@example.ng", reply(503, {}), BASE)).toEqual({ kind: "error", key: "auth.error.generic" });
  });
});

describe("enforcePhoneRecoveryHold (OQ-43) fails closed", () => {
  const client = (rpcResult: unknown | Error) => {
    const signOut = jest.fn(async () => ({}));
    const rpc = jest.fn(async () => {
      if (rpcResult instanceof Error) throw rpcResult;
      return rpcResult as { data: unknown; error: unknown };
    });
    return { c: { rpc, auth: { signOut } } as unknown as HoldClient, signOut, rpc };
  };

  it("leaves the session alone when nothing is held", async () => {
    const { c, signOut } = client({ data: { held: false }, error: null });
    expect(await enforcePhoneRecoveryHold(c)).toEqual({ kind: "clear" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out and says when, in Lagos time, when held", async () => {
    const { c, signOut } = client({ data: { held: true, until: "2026-10-16T17:30:00Z" }, error: null });
    expect(await enforcePhoneRecoveryHold(c)).toEqual({ kind: "held", untilText: "16 Oct 2026, 18:30" });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out and reports unknown on an error, an empty answer or a thrown call", async () => {
    for (const r of [{ data: null, error: { message: "x" } }, { data: null, error: null }, new Error("offline")]) {
      const { c, signOut } = client(r);
      expect(await enforcePhoneRecoveryHold(c)).toEqual({ kind: "unknown" });
      expect(signOut).toHaveBeenCalledTimes(1);
    }
  });
});

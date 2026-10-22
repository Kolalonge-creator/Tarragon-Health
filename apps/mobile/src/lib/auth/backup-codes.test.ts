import {
  backupCodesRunningLow,
  backupCodesShareText,
  fetchBackupCodeStatus,
  generateBackupCodesRemote,
} from "./backup-codes";

const BASE = "https://app.example.test";
type Init = { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal?: AbortSignal };
const reply = (status: number, body: unknown) =>
  jest.fn(async (...args: [string, Init]) => {
    void args;
    return { status, json: async () => body };
  });
const down = jest.fn(async (...args: [string, Init]): Promise<{ status: number; json(): Promise<unknown> }> => {
  void args;
  throw new Error("network");
});
const SET = ["ABCDE-FGHJK", "LMNPQ-RSTUV", "WXYZ2-34567"];

describe("fetchBackupCodeStatus", () => {
  it("sends nothing without a session", async () => {
    const f = reply(200, {});
    expect(await fetchBackupCodeStatus(null, f, BASE)).toEqual({ kind: "error", key: "auth.error.generic" });
    expect(f).not.toHaveBeenCalled();
  });
  it("reads the counts with the bearer token", async () => {
    const f = reply(200, { total: 10, remaining: 7, generatedAt: "2026-10-01T00:00:00Z" });
    expect(await fetchBackupCodeStatus("tok", f, BASE)).toEqual({ kind: "ok", status: { total: 10, remaining: 7, generatedAt: "2026-10-01T00:00:00Z" } });
    expect(f.mock.calls[0]?.[0]).toBe(`${BASE}/api/mobile/backup-codes`);
    expect(f.mock.calls[0]?.[1].method).toBe("GET");
    expect(f.mock.calls[0]?.[1].headers.Authorization).toBe("Bearer tok");
  });
  it("treats an odd answer or an outage as an error, never as zero codes", async () => {
    expect(await fetchBackupCodeStatus("tok", reply(503, { error: "unavailable" }), BASE)).toEqual({ kind: "error", key: "auth.error.generic" });
    expect(await fetchBackupCodeStatus("tok", reply(200, {}), BASE)).toEqual({ kind: "error", key: "auth.error.generic" });
    expect(await fetchBackupCodeStatus("tok", down, BASE)).toEqual({ kind: "error", key: "auth.error.offline" });
  });
});

describe("generateBackupCodesRemote", () => {
  const ok = { token: "tok", password: "secret-passphrase", confirmed: true };
  it("sends nothing until the confirmation step is passed, and never without a password or session", async () => {
    const f = reply(200, { ok: true, codes: SET });
    for (const bad of [{ ...ok, confirmed: false }, { ...ok, password: "" }]) {
      expect(await generateBackupCodesRemote(bad, f, BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_password" });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("reads a missing or rejected session as 'sign in again', not as a wrong password", async () => {
    const f = reply(401, { error: "Invalid or expired session" });
    expect(await generateBackupCodesRemote({ ...ok, token: null }, f, BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_session" });
    expect(f).not.toHaveBeenCalled();
    expect(await generateBackupCodesRemote(ok, f, BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_session" });
  });
  it("never says 'nothing changed' when the answer was lost or malformed after the server may have acted", async () => {
    expect(await generateBackupCodesRemote(ok, down, BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_unsure" });
    expect(await generateBackupCodesRemote(ok, reply(503, { ok: false, reason: "generation_failed" }), BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_unsure" });
    // a failure before anything was made says so plainly
    expect(await generateBackupCodesRemote(ok, reply(503, { ok: false, reason: "unavailable" }), BASE)).toEqual({ kind: "error", key: "auth.error.generic" });
  });
  it("posts the password in the body (never the URL) with the bearer token and returns the codes once", async () => {
    const f = reply(200, { ok: true, codes: SET });
    expect(await generateBackupCodesRemote(ok, f, BASE)).toEqual({ kind: "ok", codes: SET });
    const [url, init] = f.mock.calls[0] ?? ["", {} as Init];
    expect(url).toBe(`${BASE}/api/mobile/backup-codes`);
    expect(url).not.toMatch(/secret/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ password: "secret-passphrase" });
    expect(init.headers.Authorization).toBe("Bearer tok");
  });
  it("does not show a set that is not made of real codes", async () => {
    expect(await generateBackupCodesRemote(ok, reply(200, { ok: true, codes: ["hello"] }), BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_unsure" });
    expect(await generateBackupCodesRemote(ok, reply(200, { ok: true, codes: [] }), BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_unsure" });
    expect(await generateBackupCodesRemote(ok, reply(200, { ok: true }), BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_unsure" });
  });
  it("maps each refusal to its own plain message, with no codes", async () => {
    expect(await generateBackupCodesRemote(ok, reply(400, { ok: false, reason: "wrong_password" }), BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_password" });
    expect(await generateBackupCodesRemote(ok, reply(400, { ok: false, reason: "no_password_route" }), BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_no_route" });
    expect(await generateBackupCodesRemote(ok, reply(429, { ok: false, reason: "daily_limit" }), BASE)).toEqual({ kind: "error", key: "account.backup_codes.error_daily_limit" });
    expect(await generateBackupCodesRemote(ok, reply(429, { ok: false, reason: "rate_limited" }), BASE)).toEqual({ kind: "error", key: "auth.error.rate_limited" });
    expect(await generateBackupCodesRemote(ok, reply(400, { ok: false, reason: "invalid" }), BASE)).toEqual({ kind: "error", key: "auth.error.generic" });
  });
});

describe("helpers", () => {
  it("share text carries the codes and nothing identifying", () => {
    const text = backupCodesShareText(SET);
    for (const c of SET) expect(text).toContain(c);
    expect(text).not.toMatch(/@|\+234/);
  });
  it("nudges at two or fewer left, not when there are none made", () => {
    expect(backupCodesRunningLow({ total: 10, remaining: 2, generatedAt: null })).toBe(true);
    expect(backupCodesRunningLow({ total: 10, remaining: 3, generatedAt: null })).toBe(false);
    expect(backupCodesRunningLow({ total: 0, remaining: 0, generatedAt: null })).toBe(false);
  });
});

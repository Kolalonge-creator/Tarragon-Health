/**
 * Mobile backup-code route (S03b follow-up). Pinned: no token, no work; the password step-up for the backup_codes purpose runs
 * BEFORE the database function and is bound to the token's session; a wrong password never reaches the database; a daily limit
 * and a limiter hit read distinctly; the codes only ever come back on success; every answer is uncacheable.
 */
const getUser = jest.fn();
const rpc = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) }, rpc: (...a: unknown[]) => rpc(...a) }),
}));
const verify = jest.fn();
jest.mock("@/lib/account/step-up", () => ({
  verifyPasswordAndRecordStepUp: (...a: unknown[]) => verify(...a),
  sessionIdFromAccessToken: (t: string) => (t === "tok" ? "session-1234" : null),
}));

import { GET, POST } from "./route";

const USER = { id: "u1", email: "ada@example.ng", email_confirmed_at: "2026-01-01" };
const req = (body?: unknown, token: string | null = "tok") =>
  new Request("https://app.test/api/mobile/backup-codes", {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: USER }, error: null });
  verify.mockResolvedValue({ ok: true });
  rpc.mockResolvedValue({ data: ["ABCDE-FGHJK"], error: null });
});

describe("POST", () => {
  it("refuses with no token and does nothing", async () => {
    const res = await POST(req({ password: "x" }, null));
    expect(res.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a token Auth rejects", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("bad") });
    expect((await POST(req({ password: "x" }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a malformed or empty body before any password check", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ password: "" }))).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });
  it("checks the password for backup_codes, bound to the token session, BEFORE the database, and returns the codes", async () => {
    const res = await POST(req({ password: "secret-passphrase" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, codes: ["ABCDE-FGHJK"] });
    expect(verify).toHaveBeenCalledWith(USER, "secret-passphrase", "backup_codes", "session-1234");
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
    expect(rpc).toHaveBeenCalledWith("generate_backup_codes");
  });
  it("a wrong password never reaches the database and returns no codes", async () => {
    verify.mockResolvedValue({ ok: false, reason: "wrong_password" });
    const res = await POST(req({ password: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "wrong_password" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps the step-up limiter to 429 and an unrecordable step-up to 503", async () => {
    verify.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect((await POST(req({ password: "x" }))).status).toBe(429);
    verify.mockResolvedValue({ ok: false, reason: "unavailable" });
    expect((await POST(req({ password: "x" }))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reads the daily regeneration limit distinctly and leaks no codes on a database failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "backup_codes_rate_limited" } });
    const limited = await POST(req({ password: "x" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, reason: "daily_limit" });
    rpc.mockResolvedValue({ data: null, error: { message: "step_up_required" } });
    const failed = await POST(req({ password: "x" }));
    expect(failed.status).toBe(503);
    expect(await failed.clone().json()).toEqual({ ok: false, reason: "generation_failed" });
    expect(JSON.stringify(await failed.json())).not.toMatch(/codes/);
  });
});

describe("GET", () => {
  it("needs a token and returns only counts", async () => {
    expect((await GET(req(undefined, null))).status).toBe(401);
    rpc.mockResolvedValue({ data: { total: 10, remaining: 7, generated_at: "2026-10-01T00:00:00Z" }, error: null });
    const res = await GET(req());
    expect(await res.json()).toEqual({ total: 10, remaining: 7, generatedAt: "2026-10-01T00:00:00Z" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("fails closed with 503 when the count cannot be read, and never reports an unreadable answer as zero codes", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await GET(req())).status).toBe(503);
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await GET(req())).status).toBe(503);
    rpc.mockResolvedValue({ data: {}, error: null });
    expect((await GET(req())).status).toBe(503);
  });
});

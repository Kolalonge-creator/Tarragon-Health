/**
 * The public share door (S09x-b): the app maps the database answer to four outcomes and never leaks which kind of dead link it was.
 * The PIN rate limit, lockout, revocation and expiry themselves are proven in the database (packages/db/tests/s09x_my_health_completion.sql).
 */
const rpc = jest.fn();
jest.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import { isWellFormedPin, openShare, peekShare } from "./open-share";

const TOKEN = "a".repeat(64);

beforeEach(() => {
  rpc.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
});

describe("openShare", () => {
  it("returns the record on ok", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", full_name: "A B" }, error: null });
    const r = await openShare(TOKEN, null, null);
    expect(r.kind).toBe("ok");
  });

  it("asks for the PIN, with the attempts left after a wrong one", async () => {
    rpc.mockResolvedValue({ data: { status: "pin_required", attempts_left: 3 }, error: null });
    expect(await openShare(TOKEN, "123456", "1.2.3.4")).toEqual({ kind: "pin_required", attemptsLeft: 3 });
    rpc.mockResolvedValue({ data: { status: "pin_required" }, error: null });
    expect(await openShare(TOKEN, null, null)).toEqual({ kind: "pin_required", attemptsLeft: null });
  });

  it("maps try_later", async () => {
    rpc.mockResolvedValue({ data: { status: "try_later" }, error: null });
    expect((await openShare(TOKEN, "123456", "x")).kind).toBe("try_later");
  });

  it("treats null, an error, an odd shape and a record with no status all as unavailable", async () => {
    for (const reply of [{ data: null, error: null }, { data: null, error: { message: "boom" } }, { data: [], error: null }, { data: { full_name: "x" }, error: null }, { data: "ok", error: null }]) {
      rpc.mockResolvedValue(reply);
      expect((await openShare(TOKEN, null, null)).kind).toBe("unavailable");
    }
  });

  it("is unavailable, not an error, when the platform URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await openShare(TOKEN, null, null)).kind).toBe("unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the PIN and client key only when given", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await openShare(TOKEN, null, null);
    expect(rpc).toHaveBeenLastCalledWith("record_share_by_token", { p_token: TOKEN });
    await openShare(TOKEN, "123456", "9.9.9.9");
    expect(rpc).toHaveBeenLastCalledWith("record_share_by_token", { p_token: TOKEN, p_pin: "123456", p_client_key: "9.9.9.9" });
  });
});

describe("isWellFormedPin", () => {
  it("accepts only 4 to 12 digits", () => {
    expect(isWellFormedPin("123456")).toBe(true);
    expect(isWellFormedPin("12345")).toBe(true);
    expect(isWellFormedPin("123")).toBe(false);
    expect(isWellFormedPin("12345678901234")).toBe(false);
    expect(isWellFormedPin("12 456")).toBe(false);
    expect(isWellFormedPin("12345a")).toBe(false);
    expect(isWellFormedPin("")).toBe(false);
  });
});

describe("peekShare (the landing page: never an open)", () => {
  it("maps ready and pin_required, and everything else to unavailable", async () => {
    rpc.mockResolvedValue({ data: "ready", error: null });
    expect(await peekShare(TOKEN)).toBe("ready");
    rpc.mockResolvedValue({ data: "pin_required", error: null });
    expect(await peekShare(TOKEN)).toBe("pin_required");
    for (const reply of [{ data: null, error: null }, { data: "weird", error: null }, { data: null, error: { message: "x" } }]) {
      rpc.mockResolvedValue(reply);
      expect(await peekShare(TOKEN)).toBe("unavailable");
    }
  });

  it("calls only the peek function with the token alone, never the door", async () => {
    rpc.mockResolvedValue({ data: "ready", error: null });
    await peekShare(TOKEN);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_share_peek", { p_token: TOKEN });
  });
});

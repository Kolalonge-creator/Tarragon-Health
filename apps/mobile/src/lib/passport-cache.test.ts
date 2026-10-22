import { __resetPassportCacheForTests, cacheDeleteExcept, cacheRead, cacheWrite, clearPassportCache, isOffline, readThrough } from "./passport-cache";

let mockUser: string | null = "user-1";
jest.mock("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }) } },
}));

beforeEach(() => {
  mockUser = "user-1";
  __resetPassportCacheForTests();
});

describe("passport cache (S43m)", () => {
  it("stores and reads a copy for the signed-in account", async () => {
    await cacheWrite("history:p1", { a: 1 });
    expect((await cacheRead<{ a: number }>("history:p1"))?.value).toEqual({ a: 1 });
  });

  it("never shows one account's copy to another, and nothing when signed out", async () => {
    await cacheWrite("history:p1", { a: 1 });
    mockUser = "user-2";
    expect(await cacheRead("history:p1")).toBeNull();
    mockUser = null;
    expect(await cacheRead("history:p1")).toBeNull();
    await cacheWrite("history:p9", { b: 2 });
    mockUser = "user-1";
    expect(await cacheRead("history:p9")).toBeNull();
  });

  it("is emptied by sign-out", async () => {
    await cacheWrite("k", 1);
    await clearPassportCache();
    expect(await cacheRead("k")).toBeNull();
  });

  it("a live read refreshes the copy and is not marked stale", async () => {
    const r = await readThrough("k2", async () => ({ ok: true as const, data: [1, 2] }));
    expect(r).toEqual({ ok: true, data: [1, 2], stale: false });
    expect((await cacheRead<number[]>("k2"))?.value).toEqual([1, 2]);
  });

  it("falls back to the last copy, marked stale and offline, when the connection is lost", async () => {
    await readThrough("k3", async () => ({ ok: true as const, data: ["old"] }));
    const r = await readThrough<string[]>("k3", async () => ({ ok: false as const, error: { message: "Network request failed" } }));
    expect(r.ok && r.stale && r.offline && r.data).toEqual(["old"]);
  });

  it("a failed read never overwrites a good copy", async () => {
    await readThrough("k4", async () => ({ ok: true as const, data: ["good"] }));
    await readThrough<string[]>("k4", async () => ({ ok: false as const, error: { code: "500", message: "boom" } }));
    expect((await cacheRead<string[]>("k4"))?.value).toEqual(["good"]);
  });

  it("with no copy, reports the failure rather than an empty list", async () => {
    expect(await readThrough("never", async () => ({ ok: false as const, error: { message: "Network request failed" } }))).toEqual({ ok: false, offline: true, refused: false });
    expect(await readThrough("never", async () => ({ ok: false as const, error: { code: "42501", message: "denied" } }))).toEqual({ ok: false, offline: false, refused: true });
  });

  it("treats a thrown fetcher as a failure", async () => {
    expect(await readThrough("thrown", async () => { throw new Error("Network request failed"); })).toEqual({ ok: false, offline: true, refused: false });
  });

  it("tells a lost connection from a refusal", () => {
    expect(isOffline({ message: "Network request failed" })).toBe(true);
    expect(isOffline({ code: "42501", message: "permission denied" })).toBe(false);
  });

  it("a refusal never falls back to the copy and deletes it (withdrawn access stays withdrawn)", async () => {
    await readThrough("k5", async () => ({ ok: true as const, data: ["private"] }));
    const refused = await readThrough<string[]>("k5", async () => ({ ok: false as const, error: { code: "42501", message: "permission denied" } }));
    expect(refused).toEqual({ ok: false, offline: false, refused: true });
    expect(await cacheRead("k5")).toBeNull();
  });

  it("an expired sign-in keeps the copy and shows it as stale (the token will refresh; the offline copy is the point)", async () => {
    await readThrough("k6", async () => ({ ok: true as const, data: ["x"] }));
    const expired = await readThrough<string[]>("k6", async () => ({ ok: false as const, error: { code: "PGRST301", message: "JWT expired" } }));
    expect(expired.ok && expired.stale && expired.data).toEqual(["x"]);
    expect((await cacheRead<string[]>("k6"))?.value).toEqual(["x"]);
  });

  it("a refusal for an account that has since signed out does not delete the next account's copy", async () => {
    mockUser = "user-2";
    await cacheWrite("shared-key", ["b's"]);
    mockUser = "user-1";
    await readThrough("shared-key", async () => {
      mockUser = "user-2";
      return { ok: false as const, error: { code: "42501", message: "denied" } };
    });
    expect((await cacheRead<string[]>("shared-key"))?.value).toEqual(["b's"]);
  });

  it("a data error (not a permission refusal) keeps the copy and shows it as stale", async () => {
    await readThrough("k7", async () => ({ ok: true as const, data: ["kept"] }));
    const r = await readThrough<string[]>("k7", async () => ({ ok: false as const, error: { code: "22023", message: "invalid parameter" } }));
    expect(r.ok && r.stale && r.data).toEqual(["kept"]);
  });

  it("removes saved copies under a prefix that are no longer wanted, only for this account", async () => {
    await cacheWrite("t:a", 1);
    await cacheWrite("t:b", 2);
    await cacheWrite("other:z", 3);
    await cacheDeleteExcept("t:", ["t:a"]);
    expect(await cacheRead("t:a")).not.toBeNull();
    expect(await cacheRead("t:b")).toBeNull();
    expect(await cacheRead("other:z")).not.toBeNull();
    await cacheDeleteExcept("t:", []);
    expect(await cacheRead("t:a")).toBeNull();
  });

  it("keep:false reads live and never stores or serves a copy (someone else's record)", async () => {
    const r = await readThrough("other", async () => ({ ok: true as const, data: ["theirs"] }), { keep: false });
    expect(r).toEqual({ ok: true, data: ["theirs"], stale: false });
    expect(await cacheRead("other")).toBeNull();
    await cacheWrite("other", ["old"]);
    const offline = await readThrough<string[]>("other", async () => ({ ok: false as const, error: { message: "Network request failed" } }), { keep: false });
    expect(offline).toEqual({ ok: false, offline: true, refused: false });
  });

  it("drops a read that finished after the account changed, rather than storing it under the next account", async () => {
    const r = await readThrough("late", async () => {
      mockUser = "user-2";
      return { ok: true as const, data: ["a's record"] };
    });
    expect(r.ok).toBe(true);
    expect(await cacheRead("late")).toBeNull();
  });

  it("removes another account's rows when a different account first opens the cache", async () => {
    await cacheWrite("mine", { a: 1 });
    mockUser = "user-2";
    __resetPassportCacheForTests();
    expect(await cacheRead("mine")).toBeNull();
    mockUser = "user-1";
    __resetPassportCacheForTests();
    expect(await cacheRead("mine")).toBeNull();
  });
});

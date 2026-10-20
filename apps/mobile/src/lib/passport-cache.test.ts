import { cacheRead, cacheWrite, clearPassportCache, isOffline, readThrough } from "./passport-cache";

let mockUser: string | null = "user-1";
jest.mock("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }) } },
}));

beforeEach(() => {
  mockUser = "user-1";
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
    expect(await readThrough("never", async () => ({ ok: false as const, error: { message: "Network request failed" } }))).toEqual({ ok: false, offline: true });
    expect(await readThrough("never", async () => ({ ok: false as const, error: { code: "42501", message: "denied" } }))).toEqual({ ok: false, offline: false });
  });

  it("treats a thrown fetcher as a failure", async () => {
    expect(await readThrough("thrown", async () => { throw new Error("Network request failed"); })).toEqual({ ok: false, offline: true });
  });

  it("tells a lost connection from a refusal", () => {
    expect(isOffline({ message: "Network request failed" })).toBe(true);
    expect(isOffline({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

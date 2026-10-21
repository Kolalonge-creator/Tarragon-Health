import { issueShlForOwnShare } from "./issue-shl";
import { parseShlink } from "./smart-health-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const TOKEN = "e".repeat(64);
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const ROW = { token: TOKEN, expires_at: FUTURE, is_active: true, pin_protected: true, recipient_label: "Dr Okafor", locked_at: null, revoked_at: null };

function client(result: { data: unknown; error: unknown }) {
  const q = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn().mockResolvedValue(result) };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  return { from: jest.fn().mockReturnValue(q), q } as unknown as SupabaseClient<Database> & { q: typeof q };
}

beforeEach(() => {
  process.env.SHARE_LINK_KEY_SECRET = "k".repeat(40);
});
afterAll(() => {
  delete process.env.SHARE_LINK_KEY_SECRET;
});

describe("issueShlForOwnShare", () => {
  it("makes a link for an open share, asking for exactly the share id", async () => {
    const c = client({ data: ROW, error: null });
    const out = await issueShlForOwnShare(c, "share-1");
    expect(c.q.eq).toHaveBeenCalledWith("id", "share-1");
    expect(out.ok).toBe(true);
    const parsed = parseShlink((out as { link: string }).link);
    expect(parsed?.flag).toBe("P");
    expect(parsed?.url.endsWith(`/api/shl/${TOKEN}`)).toBe(true);
  });

  it("says not_found for a share that is not the caller's (no row under row-level security)", async () => {
    expect(await issueShlForOwnShare(client({ data: null, error: null }), "x")).toEqual({ ok: false, reason: "not_found" });
  });

  it.each([
    ["revoked", { revoked_at: "2026-01-01T00:00:00Z" }],
    ["locked", { locked_at: "2026-01-01T00:00:00Z" }],
    ["inactive", { is_active: false }],
    ["expired", { expires_at: "2020-01-01T00:00:00Z" }],
  ])("gives no link for a %s share", async (_name, over) => {
    expect(await issueShlForOwnShare(client({ data: { ...ROW, ...over }, error: null }), "x")).toEqual({ ok: false, reason: "not_found" });
  });

  it("is unavailable on a read error and when the server has no secret", async () => {
    expect(await issueShlForOwnShare(client({ data: null, error: { message: "x" } }), "x")).toEqual({ ok: false, reason: "unavailable" });
    delete process.env.SHARE_LINK_KEY_SECRET;
    expect(await issueShlForOwnShare(client({ data: ROW, error: null }), "x")).toEqual({ ok: false, reason: "unavailable" });
  });
});

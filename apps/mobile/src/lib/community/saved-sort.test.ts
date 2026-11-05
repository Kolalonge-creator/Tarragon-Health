/**
 * Saved posts and the feed order on the phone (COM-30; web: apps/web/src/app/(dashboard)/patient/community/community-actions.ts). The
 * order is sent only when it is not the default, so the Latest call is unchanged; a save goes through as the member's own session; the
 * 500 cap has its own message and anything else is the general one; database text never reaches the screen; the saved list parser
 * takes exactly the web's fields. Also pins why the database must never send is_mine null: one such row would blank a whole reply list
 * or search (migration *_community_is_mine_never_null_in_replies_and_search.sql).
 */
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args), auth: { getSession: jest.fn() } },
}));

import { loadFeed, loadSaved, setSaved } from "./api";
import { parseFeed, parseReplies, parseSavedList, parseSearchResult } from "./model";

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const post = {
  id: "p1",
  author_handle: "Quiet Heron",
  author_avatar: "leaf",
  is_mine: false,
  body: "Walking after dinner helped me.",
  created_at: "2026-11-04T10:00:00Z",
  edited_at: null,
  support_count: 0,
  reply_count: 2,
  i_supported: false,
  pending_review: false,
  answers: [],
};
const saved = {
  id: "p1",
  group_slug: "high-blood-pressure",
  group_name: "High blood pressure",
  author_handle: "Quiet Heron",
  author_avatar: null,
  is_mine: false,
  body: "Walking after dinner helped me.",
  created_at: "2026-11-04T10:00:00Z",
  saved_at: "2026-11-04T11:00:00Z",
  reply_count: 2,
  pending_review: false,
};

beforeEach(() => mockRpc.mockReset());

describe("loadFeed order", () => {
  it("sends p_sort only for Most discussed, and keeps the page cursor", async () => {
    mockRpc.mockResolvedValue(ok({ ok: true, posts: [], has_more: false }));
    await loadFeed("g");
    expect(mockRpc).toHaveBeenLastCalledWith("community_feed", { p_group_id: "g" });
    await loadFeed("g", undefined, "latest");
    expect(mockRpc).toHaveBeenLastCalledWith("community_feed", { p_group_id: "g" });
    await loadFeed("g", "2026-11-01T00:00:00Z", "discussed");
    expect(mockRpc).toHaveBeenLastCalledWith("community_feed", { p_group_id: "g", p_before: "2026-11-01T00:00:00Z", p_sort: "discussed" });
  });
  it("an unknown order from the database is a calm error, never its text", async () => {
    mockRpc.mockResolvedValue(ok({ ok: false, reason: "bad_sort" }));
    expect(await loadFeed("g", undefined, "discussed")).toEqual({ ok: false, key: "community.feed.error", definite: true });
  });
});

describe("setSaved", () => {
  it("saves as the member and returns the new state", async () => {
    mockRpc.mockResolvedValue(ok({ ok: true, saved: true }));
    expect(await setSaved("p1", true)).toEqual({ ok: true, saved: true });
    expect(mockRpc).toHaveBeenCalledWith("community_set_saved", { p_post_id: "p1", p_saved: true });
  });
  it("turns the 500 cap into its own message and anything else into the general one", async () => {
    mockRpc.mockResolvedValue(ok({ ok: false, reason: "too_many" }));
    expect(await setSaved("p1", true)).toMatchObject({ ok: false, key: "community.saved.too_many" });
    mockRpc.mockResolvedValue(ok({ ok: false, reason: "not_found" }));
    expect(await setSaved("p1", true)).toMatchObject({ ok: false, key: "community.compose.refused.other" });
  });
  it("never passes database text through", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "relation community_saved_posts secret" }, status: 500 });
    expect(JSON.stringify(await setSaved("p1", false))).not.toContain("secret");
    mockRpc.mockResolvedValue(ok({ garbage: true }));
    expect(await setSaved("p1", false)).toMatchObject({ ok: false, key: "community.compose.refused.other" });
  });
});

describe("loadSaved", () => {
  it("asks for the first page with no cursor and the next with the last saved_at", async () => {
    mockRpc.mockResolvedValue(ok({ ok: true, posts: [saved], has_more: true }));
    expect(await loadSaved()).toEqual({ ok: true, posts: [saved], has_more: true });
    expect(mockRpc).toHaveBeenLastCalledWith("community_saved_list", {});
    await loadSaved(saved.saved_at);
    expect(mockRpc).toHaveBeenLastCalledWith("community_saved_list", { p_before: saved.saved_at });
  });
  it("an unreadable answer is the calm feed error", async () => {
    mockRpc.mockResolvedValue(ok({ ok: true, posts: [{ ...saved, saved_at: 5 }], has_more: false }));
    expect(await loadSaved()).toMatchObject({ ok: false, key: "community.feed.error" });
  });
});

describe("parsers", () => {
  it("reads i_saved when present and leaves it absent on an older database", () => {
    const withSaved = parseFeed({ ok: true, has_more: false, posts: [{ ...post, i_saved: true }] });
    expect(withSaved?.ok && withSaved.posts[0]?.i_saved).toBe(true);
    const without = parseFeed({ ok: true, has_more: false, posts: [post] });
    expect(without?.ok && without.posts[0]?.i_saved).toBeUndefined();
  });
  it("the saved list parser refuses a missing field", () => {
    const { saved_at: _drop, ...noSavedAt } = saved;
    void _drop;
    expect(parseSavedList({ ok: true, posts: [noSavedAt], has_more: false })).toBeUndefined();
    expect(parseSavedList({ ok: false, reason: "not_open_yet" })).toEqual({ ok: false, reason: "not_open_yet" });
  });
  it("one is_mine null rejects a whole reply list or search, which is why the database must send false", () => {
    expect(parseReplies({ ok: true, replies: [post, { ...post, id: "p2", is_mine: null }] })).toBeUndefined();
    const hit = { id: "p1", group_name: "G", group_slug: "g", author_handle: "Quiet Heron", is_mine: null, body: "x", created_at: "2026-11-04T10:00:00Z", is_reply: false };
    expect(parseSearchResult({ ok: true, items: [hit], has_more: false })).toBeUndefined();
    expect(parseSearchResult({ ok: true, items: [{ ...hit, is_mine: false }], has_more: false })).toMatchObject({ ok: true });
  });
});

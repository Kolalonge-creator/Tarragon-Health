/**
 * The saved-posts and feed-order server actions (the Saved page reads its list in the server component): the order is sent to the database only when it is not the default (so the old call shape
 * is unchanged); a save goes through as the member's own session; a refusal becomes a calm message key; database error text never reaches
 * the screen; bad input never reaches the database.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/app/(dashboard)/patient/actions", () => ({ alertEmergencyContactNow: jest.fn().mockResolvedValue({ success: true }) }));

const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { revalidatePath } from "next/cache";
import { loadFeed, setSaved } from "./community-actions";

const GROUP = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  rpc.mockReset();
  (revalidatePath as jest.Mock).mockClear();
});

describe("loadFeed order", () => {
  it("sends p_sort only for Most discussed", async () => {
    rpc.mockResolvedValue({ data: { ok: true, posts: [], has_more: false }, error: null });
    await loadFeed({ groupId: GROUP, sort: "latest" });
    expect(rpc).toHaveBeenLastCalledWith("community_feed", { p_group_id: GROUP });
    await loadFeed({ groupId: GROUP, sort: "discussed" });
    expect(rpc).toHaveBeenLastCalledWith("community_feed", { p_group_id: GROUP, p_sort: "discussed" });
  });

  it("refuses an unknown order before the database", async () => {
    const r = await loadFeed({ groupId: GROUP, sort: "loudest" });
    expect(r).toEqual({ ok: false, key: "community.feed.error" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("setSaved", () => {
  it("saves and returns the new state without revalidating the page", async () => {
    rpc.mockResolvedValue({ data: { ok: true, saved: true }, error: null });
    expect(await setSaved({ postId: POST, saved: true })).toEqual({ ok: true, saved: true });
    expect(rpc).toHaveBeenCalledWith("community_set_saved", { p_post_id: POST, p_saved: true });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("turns the 500 cap into its own message and anything else into the general one", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "too_many" }, error: null });
    expect(await setSaved({ postId: POST, saved: true })).toEqual({ ok: false, key: "community.saved.too_many" });
    rpc.mockResolvedValue({ data: { ok: false, reason: "not_found" }, error: null });
    expect(await setSaved({ postId: POST, saved: true })).toEqual({ ok: false, key: "community.compose.refused.other" });
  });

  it("never passes database error text through, and never calls the database on bad input", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "relation community_saved_posts secret detail" } });
    const r = await setSaved({ postId: POST, saved: false });
    expect(JSON.stringify(r)).not.toContain("secret");
    rpc.mockClear();
    expect(await setSaved({ postId: "not-a-uuid", saved: true })).toEqual({ ok: false, key: "community.compose.refused.other" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

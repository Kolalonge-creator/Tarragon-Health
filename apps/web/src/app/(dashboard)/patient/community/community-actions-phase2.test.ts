/** Phase 2 server actions: search ranges, hiding, digest and appeals map to calm message keys and never leak database text. */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/app/(dashboard)/patient/actions", () => ({ alertEmergencyContactNow: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { hideAuthor, searchGroups, setDigest, submitAppeal, unhideAuthor } from "./community-actions";

const ID = "22222222-2222-4222-8222-222222222222";
const LIST = { open: true, adult: true, groups: [] };

beforeEach(() => rpc.mockReset());

describe("searchGroups", () => {
  it("searches for 2 to 60 characters and asks for the plain list otherwise", async () => {
    rpc.mockResolvedValue({ data: LIST, error: null });
    expect(await searchGroups({ q: "  ab  " })).toEqual(LIST);
    expect(rpc).toHaveBeenLastCalledWith("community_search_groups", { p_q: "ab" });
    await searchGroups({ q: "a" });
    expect(rpc).toHaveBeenLastCalledWith("community_list_groups");
    await searchGroups({ q: "x".repeat(61) });
    expect(rpc).toHaveBeenLastCalledWith("community_list_groups");
  });
  it("fails calmly on a database error or a wrong shape", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret" } });
    expect(await searchGroups({ q: "ab" })).toEqual({ ok: false, key: "community.feed.error" });
    rpc.mockResolvedValue({ data: { nope: 1 }, error: null });
    expect(await searchGroups({ q: "ab" })).toEqual({ ok: false, key: "community.feed.error" });
  });
});

describe("hideAuthor and unhideAuthor", () => {
  it("hides on success, fails with the hide message on any refusal or error", async () => {
    rpc.mockResolvedValue({ data: { status: "hidden" }, error: null });
    expect(await hideAuthor({ postId: ID })).toEqual({ ok: true });
    rpc.mockResolvedValue({ data: { status: "refused", reason: "own_post" }, error: null });
    expect(await hideAuthor({ postId: ID })).toEqual({ ok: false, key: "community.post.hide_failed" });
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await hideAuthor({ postId: ID })).toEqual({ ok: false, key: "community.post.hide_failed" });
    expect(await hideAuthor({ postId: "nope" })).toEqual({ ok: false, key: "community.post.hide_failed" });
  });
  it("unhides", async () => {
    rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    expect(await unhideAuthor({ id: ID })).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("community_unhide_author", { p_id: ID });
  });
});

describe("setDigest", () => {
  it("returns the saved value", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", digest_opt_in: true }, error: null });
    expect(await setDigest({ groupId: ID, on: true })).toEqual({ ok: true, on: true });
    expect(rpc).toHaveBeenLastCalledWith("community_set_digest", { p_group_id: ID, p_on: true });
  });
});

describe("submitAppeal", () => {
  it("maps refusals to appeal messages and success to ok", async () => {
    const input = { kind: "removal", targetId: ID, reason: "This was a mistake, please look again." };
    rpc.mockResolvedValue({ data: { status: "ok", id: ID }, error: null });
    expect(await submitAppeal(input)).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("community_appeal", { p_kind: "removal", p_target_id: ID, p_reason: input.reason });
    rpc.mockResolvedValue({ data: { status: "refused", reason: "already_appealed" }, error: null });
    expect(await submitAppeal(input)).toEqual({ ok: false, key: "community.appeals.refused.already_appealed" });
    rpc.mockResolvedValue({ data: { status: "refused", reason: "weird" }, error: null });
    expect(await submitAppeal(input)).toEqual({ ok: false, key: "community.appeals.refused.other" });
    rpc.mockResolvedValue({ data: null, error: { message: "secret_constraint" } });
    expect(JSON.stringify(await submitAppeal(input))).not.toContain("secret");
  });
  it("rejects bad input before calling the database", async () => {
    rpc.mockClear();
    expect(await submitAppeal({ kind: "other", targetId: ID, reason: "long enough reason" })).toMatchObject({ ok: false });
    expect(await submitAppeal({ kind: "removal", targetId: ID, reason: "   " })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * The Community server actions (docs/COMMUNITY_SPEC.md): a post the database withholds for emergency or self-harm language comes back as
 * the safety outcome and nothing is revalidated or kept; a blocked post returns the contact message; joining without both ticks never
 * reaches the database; and raw database error text never reaches the screen.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/app/(dashboard)/patient/actions", () => ({ alertEmergencyContactNow: jest.fn().mockResolvedValue({ success: true }) }));

const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { revalidatePath } from "next/cache";
import { deletePost, joinGroup, loadFeed, reactToPost, reportPost, submitPost } from "./community-actions";

const GROUP = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const submit = (body = "hello") => submitPost({ groupId: GROUP, parentId: null, body, clientRequestId: REQ });

beforeEach(() => {
  rpc.mockReset();
  (revalidatePath as jest.Mock).mockClear();
});

describe("submitPost", () => {
  it("turns a withheld emergency post into the safety outcome and revalidates nothing", async () => {
    rpc.mockResolvedValue({ data: { status: "withheld", safety_kind: "emergency", post_id: POST }, error: null });
    const r = await submit("my chest is tight");
    expect(r).toEqual({ ok: true, outcome: { kind: "safety", safety: "emergency", message: "community.safety.emergency.title" } });
    expect(revalidatePath).not.toHaveBeenCalled();
    // The reply carries no copy of the text back.
    expect(JSON.stringify(r)).not.toContain("chest");
  });

  it("turns a withheld self-harm post into the self-harm safety outcome", async () => {
    rpc.mockResolvedValue({ data: { status: "withheld", safety_kind: "self_harm" }, error: null });
    const r = await submit();
    expect(r).toMatchObject({ ok: true, outcome: { kind: "safety", safety: "self_harm" } });
  });

  it("returns the contact message for a blocked post and keeps nothing on the server side", async () => {
    rpc.mockResolvedValue({ data: { status: "blocked", reason: "contact" }, error: null });
    const r = await submit("call me 0801");
    expect(r).toEqual({ ok: true, outcome: { kind: "blocked", message: "community.compose.blocked.contact" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("publishes and refreshes the page, sending the client request id", async () => {
    rpc.mockResolvedValue({ data: { status: "published", post_id: POST }, error: null });
    const r = await submit();
    expect(r).toMatchObject({ ok: true, outcome: { kind: "published" } });
    expect(rpc).toHaveBeenCalledWith("community_submit_post", { p_group_id: GROUP, p_parent_id: null, p_body: "hello", p_client_request_id: REQ });
    expect(revalidatePath).toHaveBeenCalledWith("/patient/community", "layout");
  });

  it("never leaks raw database error text", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'relation "community_posts" violates secret_constraint', code: "23505" } });
    const r = await submit();
    expect(r).toEqual({ ok: false, key: "community.compose.refused.other" });
    expect(JSON.stringify(r)).not.toContain("secret_constraint");
  });

  it("treats a reply of the wrong shape as a calm failure", async () => {
    rpc.mockResolvedValue({ data: { status: "something_new_and_odd" }, error: null });
    expect(await submit()).toEqual({ ok: false, key: "community.compose.refused.other" });
    rpc.mockResolvedValue({ data: "not json", error: null });
    expect(await submit()).toEqual({ ok: false, key: "community.compose.refused.other" });
  });

  it("rejects bad input before calling the database", async () => {
    expect(await submitPost({ groupId: "nope", parentId: null, body: "x", clientRequestId: REQ })).toMatchObject({ ok: false });
    expect(await submit("   ")).toMatchObject({ ok: false, key: "community.compose.refused.empty" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("joinGroup", () => {
  it("is refused before any call when the consent is not given", async () => {
    const r = await joinGroup({ groupId: GROUP, rulesVersion: 1, rulesAcknowledged: true, consent: false });
    expect(r).toEqual({ ok: false, key: "community.join.refused.consent_needed" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is refused before any call when the rules are not acknowledged", async () => {
    const r = await joinGroup({ groupId: GROUP, rulesVersion: 1, rulesAcknowledged: false, consent: true });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the new handle on success", async () => {
    rpc.mockResolvedValue({ data: { status: "joined", handle: "Quiet Heron", avatar_code: "leaf" }, error: null });
    const r = await joinGroup({ groupId: GROUP, rulesVersion: 2, rulesAcknowledged: true, consent: true });
    expect(r).toEqual({ ok: true, handle: "Quiet Heron", avatarCode: "leaf" });
    expect(rpc).toHaveBeenCalledWith("community_join_group", { p_group_id: GROUP, p_rules_version: 2, p_consent: true });
  });

  it("maps a refusal to its message", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "rules_changed", rules_version: 3 }, error: null });
    expect(await joinGroup({ groupId: GROUP, rulesVersion: 2, rulesAcknowledged: true, consent: true })).toEqual({
      ok: false,
      key: "community.join.refused.rules_changed",
    });
  });
});

describe("other actions", () => {
  it("reports: thanks, already reported, and a calm failure", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "reported" }, error: null });
    expect(await reportPost({ postId: POST, reason: "harassment" })).toEqual({ ok: true, key: "community.report.thanks" });
    rpc.mockResolvedValueOnce({ data: { status: "already_reported" }, error: null });
    expect(await reportPost({ postId: POST, reason: "other" })).toEqual({ ok: true, key: "community.report.already" });
    expect(await reportPost({ postId: POST, reason: "not_a_reason" })).toMatchObject({ ok: false });
  });

  it("support returns the server's count", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", support_count: 4, i_supported: true }, error: null });
    expect(await reactToPost({ postId: POST, on: true })).toEqual({ ok: true, supportCount: 4, supported: true });
  });

  it("delete never shows a database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for table x" } });
    const r = await deletePost({ postId: POST });
    expect(r).toEqual({ ok: false, key: "community.compose.refused.other" });
  });

  it("older posts use the last post's time as the cursor", async () => {
    rpc.mockResolvedValue({ data: { ok: true, posts: [], has_more: false }, error: null });
    await loadFeed({ groupId: GROUP, before: "2026-10-09T10:00:00.000Z" });
    expect(rpc).toHaveBeenCalledWith("community_feed", { p_group_id: GROUP, p_before: "2026-10-09T10:00:00.000Z" });
  });
});

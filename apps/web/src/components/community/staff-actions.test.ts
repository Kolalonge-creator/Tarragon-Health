jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { revalidatePath } from "next/cache";
import { appealDecideAction, modDecideAction, modRecentAction, modRemoveRecentAction, modSanctionAction, safetyDecideAction, sampleReviewAction, setDisplayNameAction } from "./staff-actions";

const POST = "11111111-1111-4111-8111-111111111111";
const SIGNAL = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  rpc.mockReset();
  (revalidatePath as jest.Mock).mockReset();
});

describe("modDecideAction", () => {
  it("approves and refreshes the queue", async () => {
    rpc.mockResolvedValue({ data: { status: "approved" }, error: null });
    const r = await modDecideAction({ postId: POST, decision: "approve" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_mod_decide", { p_post_id: POST, p_decision: "approve" });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("removes with a reason code", async () => {
    rpc.mockResolvedValue({ data: { status: "removed" }, error: null });
    const r = await modDecideAction({ postId: POST, decision: "remove", reasonCode: "selling" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_mod_decide", { p_post_id: POST, p_decision: "remove", p_reason_code: "selling" });
  });

  it("rejects bad input before any call", async () => {
    expect((await modDecideAction({ postId: "nope", decision: "approve" })).ok).toBe(false);
    expect((await modDecideAction({ postId: POST, decision: "remove" })).ok).toBe(false);
    expect((await modDecideAction({ postId: POST, decision: "remove", reasonCode: "made up" })).ok).toBe(false);
    expect((await modDecideAction(null)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns a refusal into plain English and does not refresh", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "safety_reviewer_only" }, error: null });
    const r = await modDecideAction({ postId: POST, decision: "approve" });
    expect(r).toEqual({ ok: false, message: "Only a safety reviewer can handle this one." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("never shows raw database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "community moderators only (secret detail)" } });
    const r = await modDecideAction({ postId: POST, decision: "approve" });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("You do not have permission to do that.");
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation community_posts blew up" } });
    const r2 = await modDecideAction({ postId: POST, decision: "approve" });
    expect(r2.message).toBe("That could not be done. Please try again.");
    expect(r2.message).not.toMatch(/community_posts|blew/);
  });

  it("treats an unreadable reply as a calm failure", async () => {
    rpc.mockResolvedValue({ data: "garbage", error: null });
    expect((await modDecideAction({ postId: POST, decision: "approve" })).message).toBe("That could not be done. Please try again.");
  });
});

describe("modSanctionAction", () => {
  it("mutes for hours and never asks for a platform-wide sanction", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", sanction: "mute" }, error: null });
    const r = await modSanctionAction({ postId: POST, kind: "mute", reasonCode: "harassment", hours: 24 });
    expect(r.ok).toBe(true);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).toEqual({ p_post_id: POST, p_kind: "mute", p_reason_code: "harassment", p_hours: 24 });
    expect(args).not.toHaveProperty("p_platform_wide");
  });

  it("sends no hours for a warning or a ban", async () => {
    rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    await modSanctionAction({ postId: POST, kind: "ban", reasonCode: "other", hours: 5 });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_hours");
  });

  it("rejects missing or out-of-range hours before any call", async () => {
    expect((await modSanctionAction({ postId: POST, kind: "suspend", reasonCode: "other" })).ok).toBe(false);
    expect((await modSanctionAction({ postId: POST, kind: "mute", reasonCode: "other", hours: 0 })).ok).toBe(false);
    expect((await modSanctionAction({ postId: POST, kind: "mute", reasonCode: "other", hours: 8761 })).ok).toBe(false);
    expect((await modSanctionAction({ postId: POST, kind: "mute", reasonCode: "other", hours: 1.5 })).ok).toBe(false);
    expect((await modSanctionAction({ postId: POST, kind: "shun", reasonCode: "other" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains a refusal", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "hours_needed" }, error: null });
    const r = await modSanctionAction({ postId: POST, kind: "mute", reasonCode: "other", hours: 3 });
    expect(r.message).toBe("Please say how many hours (1 to 8760).");
  });
});

describe("safetyDecideAction", () => {
  it.each([
    ["release", "released"],
    ["keep_withheld", "kept_withheld"],
    ["close", "closed"],
  ])("%s succeeds", async (decision, status) => {
    rpc.mockResolvedValue({ data: { status }, error: null });
    const r = await safetyDecideAction({ signalId: SIGNAL, decision });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_safety_decide", { p_signal_id: SIGNAL, p_decision: decision });
  });

  it("rejects an unknown decision before any call", async () => {
    expect((await safetyDecideAction({ signalId: SIGNAL, decision: "delete" })).ok).toBe(false);
    expect((await safetyDecideAction({ signalId: "x", decision: "close" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains a signal that was already handled", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "already_handled" }, error: null });
    expect((await safetyDecideAction({ signalId: SIGNAL, decision: "close" })).message).toBe("Someone else has already handled this.");
  });
});

describe("modDecideAction send_to_safety", () => {
  it("sends a post to a safety reviewer without a reason code", async () => {
    rpc.mockResolvedValue({ data: { status: "sent_to_safety" }, error: null });
    const r = await modDecideAction({ postId: POST, decision: "send_to_safety", reasonCode: "selling" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/safety reviewer/);
    expect(rpc).toHaveBeenCalledWith("community_mod_decide", { p_post_id: POST, p_decision: "send_to_safety" });
    expect(revalidatePath).toHaveBeenCalled();
  });
  it("explains a post that is already closed", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "already_closed" }, error: null });
    expect((await modDecideAction({ postId: POST, decision: "send_to_safety" })).message).toBe("This post is already closed.");
  });
});

const APPEAL = "33333333-3333-4333-8333-333333333333";
describe("appealDecideAction", () => {
  it("upholds, sending no note when it is blank", async () => {
    rpc.mockResolvedValue({ data: { status: "upheld" }, error: null });
    const r = await appealDecideAction({ appealId: APPEAL, decision: "uphold", note: "   " });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_appeal_decide", { p_id: APPEAL, p_decision: "uphold" });
    expect(revalidatePath).toHaveBeenCalled();
  });
  it("reverses with a trimmed note", async () => {
    rpc.mockResolvedValue({ data: { status: "overturned" }, error: null });
    const r = await appealDecideAction({ appealId: APPEAL, decision: "overturn", note: " Fair point " });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/reversed/);
    expect(rpc).toHaveBeenCalledWith("community_appeal_decide", { p_id: APPEAL, p_decision: "overturn", p_note: "Fair point" });
  });
  it("rejects bad input before any call", async () => {
    expect((await appealDecideAction({ appealId: "x", decision: "uphold" })).ok).toBe(false);
    expect((await appealDecideAction({ appealId: APPEAL, decision: "delete" })).ok).toBe(false);
    expect((await appealDecideAction({ appealId: APPEAL, decision: "uphold", note: "a".repeat(501) })).ok).toBe(false);
    expect((await appealDecideAction(undefined)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("explains the own-decision and already-decided refusals, without refreshing", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "not_your_appeal_to_decide" }, error: null });
    expect((await appealDecideAction({ appealId: APPEAL, decision: "uphold" })).message).toMatch(/another moderator needs to decide/);
    rpc.mockResolvedValue({ data: { status: "refused", reason: "already_decided" }, error: null });
    expect((await appealDecideAction({ appealId: APPEAL, decision: "uphold" })).message).toBe("This appeal has already been decided.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("never shows raw database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "community moderators only (community_appeals)" } });
    const r = await appealDecideAction({ appealId: APPEAL, decision: "uphold" });
    expect(r.message).toBe("You do not have permission to do that.");
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation community_appeals broke" } });
    expect((await appealDecideAction({ appealId: APPEAL, decision: "uphold" })).message).not.toMatch(/community_appeals|broke/);
  });
});

const SAMPLE = "44444444-4444-4444-8444-444444444444";
describe("sampleReviewAction", () => {
  it("records agreement and disagreement", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", agrees: false }, error: null });
    const r = await sampleReviewAction({ sampleId: SAMPLE, agrees: false, note: "Too strict" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_sample_review", { p_id: SAMPLE, p_agrees: false, p_note: "Too strict" });
    await sampleReviewAction({ sampleId: SAMPLE, agrees: true });
    expect(rpc).toHaveBeenLastCalledWith("community_sample_review", { p_id: SAMPLE, p_agrees: true });
  });
  it("needs a real yes or no and a short note", async () => {
    expect((await sampleReviewAction({ sampleId: SAMPLE })).ok).toBe(false);
    expect((await sampleReviewAction({ sampleId: SAMPLE, agrees: "yes" })).ok).toBe(false);
    expect((await sampleReviewAction({ sampleId: SAMPLE, agrees: true, note: "a".repeat(501) })).ok).toBe(false);
    expect((await sampleReviewAction({ sampleId: "nope", agrees: true })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("explains refusals in plain English", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "your_own_decision" }, error: null });
    expect((await sampleReviewAction({ sampleId: SAMPLE, agrees: true })).message).toMatch(/another moderator needs to check/);
    rpc.mockResolvedValue({ data: { status: "refused", reason: "already_reviewed" }, error: null });
    expect((await sampleReviewAction({ sampleId: SAMPLE, agrees: true })).message).toBe("This has already been checked.");
  });
  it("never shows raw database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "update community_mod_samples failed" } });
    expect((await sampleReviewAction({ sampleId: SAMPLE, agrees: true })).message).toBe("That could not be done. Please try again.");
  });
});

describe("setDisplayNameAction", () => {
  it("saves a valid name, trimmed", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", display_name: "Ada O." }, error: null });
    const r = await setDisplayNameAction({ name: "  Ada O.  " });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_set_my_display_name", { p_name: "Ada O." });
  });
  it("an empty name clears it", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", display_name: null }, error: null });
    const r = await setDisplayNameAction({ name: "" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/will not see a name/);
    expect(rpc).toHaveBeenCalledWith("community_set_my_display_name", { p_name: "" });
  });
  it.each(["A", "7Ada", "Ada 2", "Ada@home", "a".repeat(41), "-Ada"])("rejects %s before any call", async (name) => {
    const r = await setDisplayNameAction({ name });
    expect(r).toEqual({ ok: false, message: "Use letters, spaces, commas, full stops, hyphens and apostrophes only, 2 to 40 characters. No numbers." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("accepts the allowed punctuation and the 40 character limit", async () => {
    rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    expect((await setDisplayNameAction({ name: "Dr. Ada O'Neil-Smith, RN" })).ok).toBe(true);
    expect((await setDisplayNameAction({ name: "a".repeat(40) })).ok).toBe(true);
    expect((await setDisplayNameAction({ name: "Ab" })).ok).toBe(true);
  });
  it("turns a refusal and a raised error into plain English", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "bad_name" }, error: null });
    expect((await setDisplayNameAction({ name: "Ada" })).message).toMatch(/letters, spaces/);
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "community staff only" } });
    expect((await setDisplayNameAction({ name: "Ada" })).message).toBe("You do not have permission to do that.");
  });
});

describe("modRecentAction", () => {
  const item = {
    post_id: POST, group_id: SIGNAL, group_name: "Calm", author_handle: "QuietHeron42", is_reply: false, body: "Hello", state: "visible",
    created_at: "2026-10-09T10:00:00.123456+00:00", image_id: null,
  };
  it("asks for the page older than the last post, passing the time through unchanged", async () => {
    rpc.mockResolvedValue({ data: { items: [item] }, error: null });
    const r = await modRecentAction({ before: "2026-10-09T10:00:00.123456+00:00" });
    expect(r).toEqual({ ok: true, items: [item] });
    expect(rpc).toHaveBeenCalledWith("community_mod_recent", { p_before: "2026-10-09T10:00:00.123456+00:00" });
  });
  it("passes a group when one is given", async () => {
    rpc.mockResolvedValue({ data: { items: [] }, error: null });
    await modRecentAction({ before: "2026-10-09T10:00:00Z", groupId: SIGNAL });
    expect(rpc).toHaveBeenCalledWith("community_mod_recent", { p_before: "2026-10-09T10:00:00Z", p_group_id: SIGNAL });
  });
  it("rejects bad input before any call", async () => {
    expect((await modRecentAction({ before: "not a time" })).ok).toBe(false);
    expect((await modRecentAction({ before: "2026-10-09T10:00:00Z", groupId: "x" })).ok).toBe(false);
    expect((await modRecentAction(null)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never shows database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation community_posts exploded" } });
    const r = await modRecentAction({ before: "2026-10-09T10:00:00Z" });
    expect(r).toEqual({ ok: false, message: "That could not be done. Please try again." });
  });
  it("refuses a reply of the wrong shape", async () => {
    rpc.mockResolvedValue({ data: { items: [{ post_id: 1 }] }, error: null });
    expect((await modRecentAction({ before: "2026-10-09T10:00:00Z" })).ok).toBe(false);
  });
  it("explains a permission refusal in plain English", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "community moderators only" } });
    expect(await modRecentAction({ before: "2026-10-09T10:00:00Z" })).toEqual({ ok: false, message: "You do not have permission to do that." });
  });
});

describe("modRemoveRecentAction", () => {
  it("removes a live post with one of the plain reasons", async () => {
    rpc.mockResolvedValue({ data: { status: "removed" }, error: null });
    const r = await modRemoveRecentAction({ postId: POST, reasonCode: "off_topic" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_mod_decide", { p_post_id: POST, p_decision: "remove", p_reason_code: "off_topic" });
    expect(revalidatePath).toHaveBeenCalled();
  });
  it("rejects a missing or made-up reason before any call", async () => {
    expect((await modRemoveRecentAction({ postId: POST })).ok).toBe(false);
    expect((await modRemoveRecentAction({ postId: POST, reasonCode: "because" })).ok).toBe(false);
    expect((await modRemoveRecentAction({ postId: "x", reasonCode: "unkind" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends a post that belongs to the safety reviewers back with a plain refusal", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "safety_reviewer_only" }, error: null });
    const r = await modRemoveRecentAction({ postId: POST, reasonCode: "other" });
    expect(r).toEqual({ ok: false, message: "Only a safety reviewer can handle this one." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

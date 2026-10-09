jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { revalidatePath } from "next/cache";
import { modDecideAction, modSanctionAction, safetyDecideAction } from "./staff-actions";

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

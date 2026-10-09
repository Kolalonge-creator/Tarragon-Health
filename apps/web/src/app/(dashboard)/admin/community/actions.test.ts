const mockRpc = jest.fn();
const mockRevalidate = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc: mockRpc })) }));
jest.mock("next/cache", () => ({ revalidatePath: (p: string) => mockRevalidate(p) }));

import {
  createGroupAction, editGroupAction, setGroupStatusAction, saveTopicAction, grantStaffAction, revokeStaffAction, saveRuleAction,
  deleteRuleAction, saveHostsAction, activateRuleSetAction, unmaskAction, unpinAction, newDraftAction,
} from "./actions";

const U = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRevalidate.mockReset();
});

describe("community admin actions", () => {
  it("validates inputs before calling the database", async () => {
    const r = await createGroupAction(undefined, form({ name: "Calm", slug: "Bad Slug!", description: "", topic_code: "x", rules_text: "r" }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/lowercase letters/);
    expect(mockRpc).not.toHaveBeenCalled();
    expect((await grantStaffAction(undefined, form({ profile_id: "nope", scope: "moderator" })))?.ok).toBe(false);
    expect((await saveRuleAction(undefined, form({ version: "2", class: "emergency", kind: "regex", pattern: "x", action: "hold" })))?.ok).toBe(false);
    expect((await saveRuleAction(undefined, form({ version: "2", class: "spam", kind: "detector", pattern: "not_a_detector", action: "hold" })))?.ok).toBe(false);
    expect((await saveRuleAction(undefined, form({ version: "2", class: "spam", kind: "regex", pattern: "x", action: "safety" })))?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("creates a group, always as an open draft, and revalidates", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", id: G }, error: null });
    const r = await createGroupAction(undefined, form({ name: "Calm", slug: "calm-group", description: "d", topic_code: "x", rules_text: "r" }));
    expect(r?.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_save_group", expect.objectContaining({ p_id: null, p_join_mode: "open", p_slug: "calm-group" }));
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/community/groups");
  });

  it("turns a raised database error into plain English, never raw text", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "the rules of a x group need the current Chief Medical Officer approval before it goes live" } });
    const r = await setGroupStatusAction(undefined, form({ id: G, slug: "calm", status: "active" }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/approval before it can go live/);
    expect(r?.message).not.toMatch(/need the current/);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("turns a refused reply into the staff wording", async () => {
    mockRpc.mockResolvedValue({ data: { status: "refused", reason: "bad_hostname" }, error: null });
    const r = await saveHostsAction(undefined, form({ version: "3", hosts: "tarragonhealth.ng\n*.bad.com" }));
    expect(r?.message).toMatch(/hostname looks like/);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_rule_set_params", { p_version: 3, p_allowed_hosts: ["tarragonhealth.ng", "*.bad.com"] });
  });

  it("treats a malformed reply as a failure", async () => {
    mockRpc.mockResolvedValue({ data: "weird", error: null });
    expect((await revokeStaffAction(undefined, form({ id: U })))?.ok).toBe(false);
  });

  it("grants staff, preferring a pasted id and sending null for all groups", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", id: U }, error: null });
    const r = await grantStaffAction(undefined, form({ profile_id: G, profile_id_pasted: U, scope: "safety_reviewer", group_id: "" }));
    expect(r?.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_grant_staff", { p_profile_id: U, p_scope: "safety_reviewer", p_group_id: null });
  });

  it("saves topics, rules, drafts, activation and unpin through their functions", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    expect((await saveTopicAction(undefined, form({ code: "heart_health", label: "Heart", sort_order: "5", is_active: "on" })))?.ok).toBe(true);
    expect((await newDraftAction(undefined, form({ from_version: "2" })))?.ok).toBe(true);
    expect((await saveRuleAction(undefined, form({ version: "3", class: "spam", kind: "regex", pattern: "buy now", action: "hold" })))?.ok).toBe(true);
    expect((await deleteRuleAction(undefined, form({ version: "3", rule_id: "9" })))?.ok).toBe(true);
    expect((await activateRuleSetAction(undefined, form({ version: "3" })))?.ok).toBe(true);
    expect((await unpinAction(undefined, form({ id: U, group_id: G })))?.ok).toBe(true);
    expect((await editGroupAction(undefined, form({ id: G, slug: "calm", name: "Calm", description: "", topic_code: "x", rules_text: "r" })))?.ok).toBe(true);
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual([
      "community_admin_save_topic", "community_admin_rule_set_create", "community_admin_rule_save", "community_admin_rule_delete",
      "community_admin_rule_set_activate", "community_admin_unpin", "community_admin_save_group",
    ]);
  });

  describe("unmask", () => {
    it("returns the identity once on success, with the audit wording", async () => {
      mockRpc.mockResolvedValue({ data: { status: "ok", profile_id: U, full_name: "Ada Obi" }, error: null });
      const r = await unmaskAction(undefined, form({ group_id: G, handle: "calm-heron", reason: "Safety review of a flagged post" }));
      expect(r?.ok).toBe(true);
      expect(r?.result).toEqual({ profile_id: U, full_name: "Ada Obi" });
      expect(r?.message).toMatch(/Chief Medical Officer has been told/);
      expect(r?.message).not.toContain("Ada");
    });
    it("shows the short-reason and daily-limit refusals in plain English", async () => {
      mockRpc.mockResolvedValue({ data: { status: "refused", reason: "reason_too_short" }, error: null });
      expect((await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: "x" })))?.message).toMatch(/too short/);
      mockRpc.mockResolvedValue({ data: { status: "refused", reason: "daily_limit" }, error: null });
      const r = await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: "x" }));
      expect(r?.message).toMatch(/today's limit/);
      expect(r?.result).toBeUndefined();
    });
    it("validates input and never leaks raw errors", async () => {
      expect((await unmaskAction(undefined, form({ group_id: "bad", handle: "h", reason: "r" })))?.ok).toBe(false);
      expect(mockRpc).not.toHaveBeenCalled();
      mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "select full_name from profiles failed" } });
      const r = await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: "r" }));
      expect(r?.message).not.toMatch(/profiles|select/);
    });
  });
});

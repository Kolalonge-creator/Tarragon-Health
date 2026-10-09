const mockRpc = jest.fn();
const mockRevalidate = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc: mockRpc })) }));
jest.mock("next/cache", () => ({ revalidatePath: (p: string) => mockRevalidate(p) }));

import {
  createGroupAction, editGroupAction, setGroupStatusAction, saveTopicAction, grantStaffAction, revokeStaffAction, saveRuleAction,
  deleteRuleAction, saveHostsAction, activateRuleSetAction, unmaskAction, setDpoAction, unpinAction, newDraftAction, setGroupCapAction, savePromptAction, endPromptAction,
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
    const REASON = "Safety review of a flagged post";
    it("returns the identity once on success, with the audit wording", async () => {
      mockRpc.mockResolvedValue({ data: { status: "ok", profile_id: U, full_name: "Ada Obi" }, error: null });
      const r = await unmaskAction(undefined, form({ group_id: G, handle: "calm-heron", reason: REASON }));
      expect(r?.ok).toBe(true);
      expect(r?.result).toEqual({ profile_id: U, full_name: "Ada Obi" });
      expect(r?.message).toMatch(/Chief Medical Officer and the data protection officer have been told/);
      expect(r?.message).not.toContain("Ada");
    });
    it("shows each refusal in plain English", async () => {
      mockRpc.mockResolvedValue({ data: { status: "refused", reason: "reason_too_short" }, error: null });
      expect((await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON })))?.message).toMatch(/too short/);
      mockRpc.mockResolvedValue({ data: { status: "refused", reason: "daily_limit" }, error: null });
      const r = await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON }));
      expect(r?.message).toMatch(/today's limit/);
      expect(r?.result).toBeUndefined();
      mockRpc.mockResolvedValue({ data: { status: "refused", reason: "no_safety_signal" }, error: null });
      const n = await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON }));
      expect(n?.ok).toBe(false);
      expect(n?.message).toMatch(/no recent safety concern about that name in that group/);
      expect(n?.message).not.toMatch(/no_safety_signal/);
    });
    it("refuses a reason under 20 characters before calling the database", async () => {
      const r = await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: "too short" }));
      expect(r?.ok).toBe(false);
      expect(r?.message).toMatch(/at least 20/);
      expect(mockRpc).not.toHaveBeenCalled();
    });
    it("validates input and never leaks raw errors", async () => {
      expect((await unmaskAction(undefined, form({ group_id: "bad", handle: "h", reason: REASON })))?.ok).toBe(false);
      expect(mockRpc).not.toHaveBeenCalled();
      mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "select full_name from profiles failed" } });
      const r = await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON }));
      expect(r?.message).not.toMatch(/profiles|select/);
      mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "admins, the Chief Medical Officer and doctors only" } });
      expect((await unmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON })))?.message).toBe("This is for doctors, the Chief Medical Officer and admins.");
    });
  });

  describe("data protection officer", () => {
    it("names and removes, validating the id first", async () => {
      expect((await setDpoAction(undefined, form({ profile_id: "nope", on: "true" })))?.ok).toBe(false);
      expect(mockRpc).not.toHaveBeenCalled();
      mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
      const r = await setDpoAction(undefined, form({ profile_id: U, on: "true" }));
      expect(r?.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("community_admin_set_dpo", { p_profile_id: U, p_on: true });
      await setDpoAction(undefined, form({ profile_id: "", profile_id_pasted: U, on: "false" }));
      expect(mockRpc).toHaveBeenLastCalledWith("community_admin_set_dpo", { p_profile_id: U, p_on: false });
    });
    it("explains refusals and hides raw database text", async () => {
      mockRpc.mockResolvedValue({ data: { status: "refused", reason: "no_such_member" }, error: null });
      expect((await setDpoAction(undefined, form({ profile_id: U, on: "true" })))?.message).toBe("That person does not have an active account.");
      mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "admins only" } });
      expect((await setDpoAction(undefined, form({ profile_id: U, on: "true" })))?.message).toBe("Only an admin can do that.");
      mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "insert into community_dpo failed" } });
      expect((await setDpoAction(undefined, form({ profile_id: U, on: "true" })))?.message).not.toMatch(/insert|community_dpo/);
    });
  });
});

describe("group size cap", () => {
  it("sends a whole number, and null for an empty box", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", member_cap: 250 }, error: null });
    const r = await setGroupCapAction(undefined, form({ id: G, cap: "250" }));
    expect(r?.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_set_group_cap", { p_id: G, p_cap: 250 });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/community/groups");
    const cleared = await setGroupCapAction(undefined, form({ id: G, cap: "  " }));
    expect(cleared?.message).toMatch(/limit was removed/);
    expect(mockRpc).toHaveBeenLastCalledWith("community_admin_set_group_cap", { p_id: G, p_cap: null });
  });
  it.each(["9", "100001", "12.5", "abc", "-20"])("rejects %s before any call, with the limits in the message", async (cap) => {
    const r = await setGroupCapAction(undefined, form({ id: G, cap }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/10 to 100000/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("accepts both ends of the range", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    expect((await setGroupCapAction(undefined, form({ id: G, cap: "10" })))?.ok).toBe(true);
    expect((await setGroupCapAction(undefined, form({ id: G, cap: "100000" })))?.ok).toBe(true);
  });
  it("rejects a bad group id, explains a refusal and hides raw errors", async () => {
    expect((await setGroupCapAction(undefined, form({ id: "x", cap: "20" })))?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: { status: "refused", reason: "bad_cap" }, error: null });
    expect((await setGroupCapAction(undefined, form({ id: G, cap: "20" })))?.message).toMatch(/whole number from 10 to 100000/);
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "update community_groups set member_cap failed" } });
    expect((await setGroupCapAction(undefined, form({ id: G, cap: "20" })))?.message).not.toMatch(/community_groups|member_cap/);
  });
});

describe("group prompts", () => {
  it("saves a prompt, reading typed times as Lagos time", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", id: U }, error: null });
    const r = await savePromptAction(undefined, form({ group_id: G, body: "  Welcome. What helped you this week?  ", show_from: "2026-10-12T09:00", show_until: "2026-10-19T09:00" }));
    expect(r?.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_save_prompt", {
      p_group_id: G, p_body: "Welcome. What helped you this week?", p_show_from: "2026-10-12T08:00:00.000Z", p_show_until: "2026-10-19T08:00:00.000Z",
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/community/prompts");
  });
  it("sends null times when they are left empty", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    await savePromptAction(undefined, form({ group_id: G, body: "A weekly question", show_from: "", show_until: "" }));
    expect(mockRpc).toHaveBeenCalledWith("community_admin_save_prompt", { p_group_id: G, p_body: "A weekly question", p_show_from: null, p_show_until: null });
  });
  it("holds the body to 5 to 300 characters before any call", async () => {
    for (const body of ["abcd", "", "a".repeat(301)]) {
      const r = await savePromptAction(undefined, form({ group_id: G, body }));
      expect(r?.ok).toBe(false);
      expect(r?.message).toBe("Please write between 5 and 300 characters.");
    }
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    expect((await savePromptAction(undefined, form({ group_id: G, body: "abcde" })))?.ok).toBe(true);
    expect((await savePromptAction(undefined, form({ group_id: G, body: "a".repeat(300) })))?.ok).toBe(true);
  });
  it("rejects an end before the start, a bad time and a bad group", async () => {
    const early = await savePromptAction(undefined, form({ group_id: G, body: "A weekly question", show_from: "2026-10-12T09:00", show_until: "2026-10-12T08:00" }));
    expect(early?.message).toBe("The end time must be after the start time.");
    expect((await savePromptAction(undefined, form({ group_id: G, body: "A weekly question", show_from: "next week" })))?.ok).toBe(false);
    expect((await savePromptAction(undefined, form({ group_id: "x", body: "A weekly question" })))?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("explains the filter refusal in plain English", async () => {
    mockRpc.mockResolvedValue({ data: { status: "refused", reason: "text_not_allowed" }, error: null });
    const r = await savePromptAction(undefined, form({ group_id: G, body: "Call me on 0803 000 0000" }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/phone number, email, link/);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
  it("never shows raw database text", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "admins, the Chief Medical Officer and moderators of this group only" } });
    const r = await savePromptAction(undefined, form({ group_id: G, body: "A weekly question" }));
    expect(r?.message).toBe("You do not have permission to do that.");
  });
  it("ends a prompt, and refuses a bad id before any call", async () => {
    expect((await endPromptAction(undefined, form({ id: "nope" })))?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    const r = await endPromptAction(undefined, form({ id: U }));
    expect(r?.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_end_prompt", { p_id: U });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/community/prompts");
  });
});

describe("granting staff to an admin account", () => {
  it("shows a plain English sentence for the database refusal", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "community moderation is granted to an active care coordinator account" } });
    const r = await grantStaffAction(undefined, form({ profile_id: U, scope: "moderator" }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toBe("Only an active care coordinator account can be given a community permission. Admin accounts cannot.");
  });
});

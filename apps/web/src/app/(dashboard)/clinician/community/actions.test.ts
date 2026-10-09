jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import {
  activateRuleSetAction,
  approveGroupRulesAction,
  deleteSafetyRuleAction,
  pinNoteAction,
  reviewPinAction,
  saveSafetyRuleAction,
} from "./actions";

const GROUP = "33333333-3333-4333-8333-333333333333";
const NOTE = "44444444-4444-4444-8444-444444444444";

beforeEach(() => rpc.mockReset());

describe("approveGroupRulesAction", () => {
  it("approves the version the CMO was looking at", async () => {
    rpc.mockResolvedValue({ data: { status: "approved", rules_version: 3 }, error: null });
    const r = await approveGroupRulesAction({ groupId: GROUP, rulesVersion: 3 });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_cmo_approve_group_rules", { p_group_id: GROUP, p_rules_version: 3 });
  });
  it("says so when the rules changed", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "rules_changed", rules_version: 4 }, error: null });
    const r = await approveGroupRulesAction({ groupId: GROUP, rulesVersion: 3 });
    expect(r).toEqual({ ok: false, message: "The rules changed while you were looking. Please reload and check them." });
  });
  it("rejects bad input", async () => {
    expect((await approveGroupRulesAction({ groupId: "x", rulesVersion: 3 })).ok).toBe(false);
    expect((await approveGroupRulesAction({ groupId: GROUP, rulesVersion: 0 })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saveSafetyRuleAction", () => {
  it("saves a regex rule with the safety action", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", id: 9 }, error: null });
    const r = await saveSafetyRuleAction({ version: 2, ruleClass: "emergency", pattern: "  \\ychest pain\\y ", note: "x" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_admin_rule_save", {
      p_version: 2,
      p_class: "emergency",
      p_kind: "regex",
      p_pattern: "\\ychest pain\\y",
      p_action: "safety",
      p_note: "x",
    });
  });
  it("rejects an empty pattern and any class but emergency or self_harm, before any call", async () => {
    expect((await saveSafetyRuleAction({ version: 2, ruleClass: "emergency", pattern: "   " })).ok).toBe(false);
    expect((await saveSafetyRuleAction({ version: 2, ruleClass: "spam", pattern: "x" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows a pattern that cannot compile in plain English, without database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "2201B", message: 'invalid regular expression: parentheses () not balanced' } });
    const r = await saveSafetyRuleAction({ version: 2, ruleClass: "self_harm", pattern: "(" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not a valid regular expression/);
    expect(r.message).not.toMatch(/parentheses/);
  });
  it("explains a refusal for a non-CMO", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "only the Chief Medical Officer writes emergency and self-harm rules" } });
    const r = await saveSafetyRuleAction({ version: 2, ruleClass: "emergency", pattern: "x" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Chief Medical Officer/);
  });
});

describe("deleteSafetyRuleAction and activateRuleSetAction", () => {
  it("deletes by id", async () => {
    rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    expect((await deleteSafetyRuleAction({ ruleId: 5 })).ok).toBe(true);
    expect((await deleteSafetyRuleAction({ ruleId: "5" })).ok).toBe(false);
  });
  it("activates a version and explains a refused activation", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", version: 2 }, error: null });
    expect((await activateRuleSetAction({ version: 2 })).ok).toBe(true);
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "a filter rule set cannot go live without blocking phone numbers" } });
    const r = await activateRuleSetAction({ version: 2 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/phone numbers, email addresses, links and handles/);
    expect(r.message).not.toMatch(/filter rule set cannot/);
    expect((await activateRuleSetAction({ version: -1 })).ok).toBe(false);
  });
});

describe("notes", () => {
  it("pins a note", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", id: NOTE }, error: null });
    const r = await pinNoteAction({ groupId: GROUP, title: " Hello ", body: " Text " });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_clinician_pin", { p_group_id: GROUP, p_title: "Hello", p_body: "Text" });
  });
  it("rejects an empty title or body", async () => {
    expect((await pinNoteAction({ groupId: GROUP, title: " ", body: "x" })).ok).toBe(false);
    expect((await pinNoteAction({ groupId: GROUP, title: "x", body: "" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps a too-short title to plain English", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: 'new row violates check constraint "community_pinned_content_title_check"' } });
    const r = await pinNoteAction({ groupId: GROUP, title: "ab", body: "x" });
    expect(r.message).not.toMatch(/constraint/);
  });
  it("a clinician reviewing their own note is refused calmly", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "not_reviewable" }, error: null });
    const r = await reviewPinAction({ id: NOTE });
    expect(r).toEqual({ ok: false, message: "You cannot review this note. A different clinician has to." });
  });
  it("reviews a note", async () => {
    rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    expect((await reviewPinAction({ id: NOTE })).ok).toBe(true);
    expect((await reviewPinAction({ id: "no" })).ok).toBe(false);
  });
});
